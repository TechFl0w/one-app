"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEmail } from "@/email/compose";
import { ensureEmailSettings, saveEmailSettings, sendEmail } from "@/server/email";
import { getCurrentBlueprint } from "@/server/blueprints";
import type { SettingsState } from "@/components/inbox/EmailSettingsForm";

export async function markInboxRead(businessId: string, id: number) {
  const supabase = await createClient();
  await supabase.from("inbox_messages").update({ read_at: new Date().toISOString() }).eq("business_id", businessId).eq("id", id).is("read_at", null);
  revalidatePath(`/b/${businessId}`, "layout");
}

export async function saveEmailSettingsAction(businessId: string, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const fromName = String(form.get("from_name") ?? "").trim();
  const ownerEmail = String(form.get("owner_email") ?? "").trim();
  if (!fromName) return { ok: false, message: "Give the sender a name." };
  if (ownerEmail && !isEmail(ownerEmail)) return { ok: false, message: "That email address doesn’t look right." };
  const replyMode = form.get("reply_mode") === "owner" ? "owner" : "inbound";
  if (replyMode === "owner" && !ownerEmail) return { ok: false, message: "Add your email to get replies there." };
  try {
    await saveEmailSettings(await createClient(), { businessId, fromName, replyMode, ownerEmail: ownerEmail || null, forwardToOwner: form.get("forward_to_owner") === "on" });
    revalidatePath(`/b/${businessId}/settings/email`);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t save." };
  }
}

/** (prev state, form data) are passed by useActionState and unused here. */
export async function sendTestEmailAction(businessId: string): Promise<SettingsState> {
  try {
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    // Reading settings as the user proves they're an owner/admin (RLS) before the service role sends.
    const settings = await ensureEmailSettings(supabase, businessId, bp.business.name);
    if (!settings.ownerEmail) return { ok: false, message: "Add your email above and save first." };
    const r = await sendEmail(createAdminClient(), settings, {
      to: settings.ownerEmail,
      subject: `Test email from ${settings.fromName}`,
      text: `This is how your customers will see emails from ${settings.fromName}.\n\nReply to check where replies end up.`,
      key: `test:${Date.now()}`,
    });
    return r.sent ? { ok: true, message: `Sent to ${settings.ownerEmail}.` } : { ok: false, message: r.reason };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t send." };
  }
}
