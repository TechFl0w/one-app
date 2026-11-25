import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { composeEmail, emailDomains, slugify, type EmailSettings } from "@/email/compose";
import { forwardedCopy, type InboundDeps, type InboxRow } from "@/email/inbound";

/** Resend wiring. Without RESEND_API_KEY, sends are logged as skipped (the app still works). */

export const resendClient = () => (process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null);

type SettingsRow = { business_id: string; slug: string; from_name: string; reply_mode: "owner" | "inbound"; owner_email: string | null; forward_to_owner: boolean };
const toSettings = (r: SettingsRow): EmailSettings => ({
  businessId: r.business_id,
  slug: r.slug,
  fromName: r.from_name,
  replyMode: r.reply_mode,
  ownerEmail: r.owner_email,
  forwardToOwner: r.forward_to_owner,
});

/** Email settings for a business, created with defaults (inbound slug from the name) on first use. */
export async function ensureEmailSettings(db: SupabaseClient, businessId: string, businessName: string): Promise<EmailSettings> {
  const { data, error } = await db.from("business_email").select("*").eq("business_id", businessId).maybeSingle();
  if (error) throw new Error(`Could not load email settings: ${error.message}`);
  if (data) return toSettings(data as SettingsRow);
  const base = slugify(businessName);
  for (const slug of [base, `${base}-${randomBytes(2).toString("hex")}`, `${base}-${randomBytes(3).toString("hex")}`]) {
    const ins = await db
      .from("business_email")
      .insert({ business_id: businessId, slug, from_name: businessName.slice(0, 64) })
      .select("*")
      .single();
    if (!ins.error) return toSettings(ins.data as SettingsRow);
    if (ins.error.code !== "23505") throw new Error(`Could not set up email: ${ins.error.message}`);
    // 23505 = slug taken (or a concurrent insert for this business): try again / re-read
    const again = await db.from("business_email").select("*").eq("business_id", businessId).maybeSingle();
    if (again.data) return toSettings(again.data as SettingsRow);
  }
  throw new Error("Could not find a free inbound address");
}

export async function saveEmailSettings(db: SupabaseClient, s: Pick<EmailSettings, "businessId" | "fromName" | "replyMode" | "ownerEmail" | "forwardToOwner">) {
  const { error } = await db
    .from("business_email")
    .update({ from_name: s.fromName, reply_mode: s.replyMode, owner_email: s.ownerEmail, forward_to_owner: s.forwardToOwner, updated_at: new Date().toISOString() })
    .eq("business_id", s.businessId);
  if (error) throw new Error(`Could not save email settings: ${error.message}`);
}

/** Resend idempotency keys are capped in length; hash ours. */
const idempotencyKey = (businessId: string, key: string) => createHash("sha256").update(`${businessId}:${key}`).digest("hex");

/**
 * Sends one email at most once per (business, key): logged in outbound_messages, and Resend
 * gets an Idempotency-Key, so retries after a crash don't double-send. Needs the service role.
 */
export async function sendEmail(
  admin: SupabaseClient,
  settings: EmailSettings,
  msg: { to: string; subject: string; text: string; replyTo?: string; key: string },
): Promise<{ sent: true } | { sent: false; reason: string }> {
  const email = composeEmail(settings, emailDomains(), msg);
  const ins = await admin
    .from("outbound_messages")
    .upsert({ business_id: settings.businessId, key: msg.key, channel: "email", to_address: email.to, subject: email.subject, body_text: email.text }, { onConflict: "business_id,key", ignoreDuplicates: true })
    .select("id");
  if (ins.error) throw new Error(`Could not log email: ${ins.error.message}`);
  if (!ins.data?.length) {
    const prev = await admin.from("outbound_messages").select("status").eq("business_id", settings.businessId).eq("key", msg.key).single();
    if (prev.data?.status === "sent" || prev.data?.status === "skipped") return prev.data.status === "sent" ? { sent: true } : { sent: false, reason: "Already handled" };
  }
  const mark = (patch: Record<string, unknown>) => admin.from("outbound_messages").update(patch).eq("business_id", settings.businessId).eq("key", msg.key);

  const resend = resendClient();
  if (!resend) {
    await mark({ status: "skipped", error: "RESEND_API_KEY not set" });
    return { sent: false, reason: "Email isn’t set up on this server yet" };
  }
  const r = await resend.emails.send(
    { from: email.from, to: email.to, replyTo: email.replyTo, subject: email.subject, text: email.text, headers: email.headers },
    { idempotencyKey: idempotencyKey(settings.businessId, msg.key) },
  );
  if (r.error) {
    await mark({ status: "failed", error: r.error.message });
    throw new Error(`Email failed: ${r.error.message}`); // the automation runner retries
  }
  await mark({ status: "sent", provider_id: r.data?.id ?? null, sent_at: new Date().toISOString(), error: null });
  return { sent: true };
}

/** Real dependencies for inbound handling (service role). */
export function inboundDeps(admin: SupabaseClient): InboundDeps {
  return {
    async settingsBySlug(slug) {
      const { data } = await admin.from("business_email").select("*").eq("slug", slug).maybeSingle();
      return data ? toSettings(data as SettingsRow) : null;
    },
    async fetchEmail(id) {
      const resend = resendClient();
      if (!resend) throw new Error("RESEND_API_KEY not set");
      const r = await resend.emails.receiving.get(id);
      if (r.error || !r.data) throw new Error(`Could not fetch email ${id}: ${r.error?.message}`);
      return { from: r.data.from, to: r.data.to, subject: r.data.subject, text: r.data.text, html: r.data.html, created_at: r.data.created_at };
    },
    async saveInbox(row: InboxRow) {
      const { data, error } = await admin
        .from("inbox_messages")
        .upsert(
          {
            business_id: row.businessId, provider_id: row.providerId, from_address: row.fromAddress, from_name: row.fromName, to_addresses: row.toAddresses,
            subject: row.subject, text_body: row.text, html_body: row.html, received_at: row.receivedAt,
          },
          { onConflict: "provider_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) throw new Error(`Could not store email: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async forwardToOwner(settings, row) {
      const f = forwardedCopy(row);
      await sendEmail(admin, settings, { to: settings.ownerEmail!, subject: f.subject, text: f.text, replyTo: f.replyTo, key: `fwd:${row.providerId}` });
      await admin.from("inbox_messages").update({ forwarded_at: new Date().toISOString() }).eq("provider_id", row.providerId);
    },
  };
}
