import "server-only";
import { isTestBusiness } from "./testMode";
import twilio from "twilio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineStatusFromSender, STARTER_TEMPLATES, waAddress, type InboundWhatsApp, type LineStatus } from "@/whatsapp/core";
import type { Conversation, InboundDeps } from "@/whatsapp/inbound";
import { runCustomerTurn } from "@/agent/customerAgent";
import type { Message } from "@/agent/ownerAgent";
import { supabaseOwnerBackend } from "./ownerBackend";

/**
 * Twilio WhatsApp wiring (service role for all writes). One Twilio account for the platform;
 * each business gets its own number + WhatsApp sender. Without TWILIO_* env vars nothing here
 * runs and messages fall back to email.
 */

export const whatsappConfigured = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

export function twilioClient() {
  if (!whatsappConfigured()) throw new Error("WhatsApp isn’t set up on this server (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)");
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
export const webhookUrl = () => `${appUrl()}/api/webhooks/twilio`;

export interface WhatsAppLine {
  businessId: string;
  phone: string | null;
  status: LineStatus;
  senderSid: string | null;
  displayName: string | null;
  lastError: string | null;
}

export async function getLine(db: SupabaseClient, businessId: string): Promise<WhatsAppLine | null> {
  const { data } = await db.from("whatsapp_lines").select("*").eq("business_id", businessId).maybeSingle();
  return data
    ? { businessId, phone: data.phone_e164, status: data.status, senderSid: data.sender_sid, displayName: data.display_name, lastError: data.last_error }
    : null;
}

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

// ---------- sending ----------

export type OutboundBody = { body: string } | { contentSid: string; variables: Record<string, string> };

/**
 * Sends a WhatsApp message from the business's line and logs it in the conversation. With a
 * `key`, it's sent at most once (automations retry). Free-form bodies are only allowed within
 * 24h of the customer's last message; outside it, use an approved template.
 */
export async function sendWhatsApp(
  admin: SupabaseClient,
  businessId: string,
  to: string,
  content: OutboundBody,
  opts: { author: "agent" | "owner" | "automation"; key?: string; preview?: string },
): Promise<{ sid: string }> {
  const line = await getLine(admin, businessId);
  if (!line?.phone || line.status !== "online") throw new Error("WhatsApp isn’t connected for this business yet");
  if (opts.key) {
    const ins = await admin
      .from("outbound_messages")
      .upsert({ business_id: businessId, key: opts.key, channel: "whatsapp", to_address: to, body_text: opts.preview ?? ("body" in content ? content.body : content.contentSid) }, { onConflict: "business_id,key", ignoreDuplicates: true })
      .select("id");
    if (ins.error) throw new Error(ins.error.message);
    if (!ins.data?.length) {
      const prev = await admin.from("outbound_messages").select("status, provider_id").eq("business_id", businessId).eq("key", opts.key).single();
      if (prev.data?.status === "sent") return { sid: prev.data.provider_id };
    }
  }
  const msg = await twilioClient().messages.create({
    from: waAddress(line.phone),
    to: waAddress(to),
    ...("body" in content ? { body: content.body } : { contentSid: content.contentSid, contentVariables: JSON.stringify(content.variables) }),
  });
  if (opts.key) await admin.from("outbound_messages").update({ status: "sent", provider_id: msg.sid, sent_at: new Date().toISOString() }).eq("business_id", businessId).eq("key", opts.key);

  const conv = await upsertConversation(admin, businessId, to, null);
  await admin.from("conversation_messages").insert({
    conversation_id: conv.id, business_id: businessId, direction: "out", author: opts.author,
    body: opts.preview ?? ("body" in content ? content.body : `Template ${content.contentSid}`), provider_sid: msg.sid, status: msg.status,
  });
  await admin.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conv.id);
  return { sid: msg.sid };
}

type ConvRow = { id: string; business_id: string; customer_phone: string; mode: "agent" | "owner"; agent_history: unknown[] };
const toConv = (r: ConvRow): Conversation => ({ id: r.id, businessId: r.business_id, customerPhone: r.customer_phone, mode: r.mode, history: r.agent_history ?? [] });

async function upsertConversation(admin: SupabaseClient, businessId: string, phone: string, name: string | null): Promise<Conversation> {
  const existing = await admin.from("conversations").select("*").eq("business_id", businessId).eq("channel", "whatsapp").eq("customer_phone", phone).maybeSingle();
  if (existing.data) {
    if (name && existing.data.customer_name !== name) await admin.from("conversations").update({ customer_name: name }).eq("id", existing.data.id);
    return toConv(existing.data as ConvRow);
  }
  const ins = await admin
    .from("conversations")
    .upsert({ business_id: businessId, channel: "whatsapp", customer_phone: phone, customer_name: name }, { onConflict: "business_id,channel,customer_phone" })
    .select("*")
    .single();
  return toConv(must(ins, "conversation") as ConvRow);
}

/** Real dependencies for handleInboundWhatsApp. */
export function inboundDeps(admin: SupabaseClient): InboundDeps {
  return {
    async businessForNumber(e164) {
      const { data } = await admin.from("whatsapp_lines").select("business_id").eq("phone_e164", e164).eq("status", "online").maybeSingle();
      return data?.business_id ?? null;
    },
    conversation: (businessId, phone, name) => upsertConversation(admin, businessId, phone, name),
    async saveInbound(conv, msg: InboundWhatsApp) {
      const ins = await admin
        .from("conversation_messages")
        .upsert({ conversation_id: conv.id, business_id: conv.businessId, direction: "in", author: "customer", body: msg.body || (msg.numMedia ? "[media]" : ""), provider_sid: msg.messageSid }, { onConflict: "provider_sid", ignoreDuplicates: true })
        .select("id");
      if (ins.error) throw new Error(ins.error.message);
      if (!ins.data?.length) return false;
      const now = new Date().toISOString();
      const { data: c } = await admin.from("conversations").select("unread").eq("id", conv.id).single();
      await admin.from("conversations").update({ last_inbound_at: now, last_message_at: now, unread: (c?.unread ?? 0) + 1 }).eq("id", conv.id);
      return true;
    },
    async agentReply(conv, msg) {
      // The customer agent works on this business's data only; writes are tagged "public"
      // so they show in the audit log and still trigger automations.
      const backend = supabaseOwnerBackend(admin, conv.businessId);
      const history = (conv.history.length > 40 ? [] : conv.history) as Message[];
      return runCustomerTurn({ backend, ctx: { phone: conv.customerPhone, profileName: msg.profileName }, history, message: msg.body });
    },
    async send(conv, body, author) {
      await sendWhatsApp(admin, conv.businessId, conv.customerPhone, { body }, { author });
    },
    async saveConversation(conv, patch) {
      await admin
        .from("conversations")
        .update({ ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.history ? { agent_history: patch.history } : {}) })
        .eq("id", conv.id);
    },
    async notifyOwner(businessId, text, conv) {
      await admin
        .from("notifications")
        .upsert({ business_id: businessId, key: `wa:${conv.id}:${Date.now()}`, message: text, link: { conversationId: conv.id } }, { onConflict: "business_id,key", ignoreDuplicates: true });
    },
  };
}

// ---------- setting up a line ----------

export async function searchNumbers(country: "CA" | "US", areaCode?: number) {
  const list = await twilioClient().availablePhoneNumbers(country).local.list({ ...(areaCode ? { areaCode } : {}), smsEnabled: true, limit: 10 });
  return list.map((n) => ({ phone: n.phoneNumber, label: n.friendlyName, locality: n.locality, region: n.region }));
}

export async function buyNumber(admin: SupabaseClient, businessId: string, phone: string, label: string) {
  const existing = await getLine(admin, businessId);
  if (existing?.phone) throw new Error("This business already has a WhatsApp number");
  const n = await twilioClient().incomingPhoneNumbers.create({ phoneNumber: phone, friendlyName: label.slice(0, 64), smsUrl: webhookUrl() });
  must(
    await admin.from("whatsapp_lines").upsert({ business_id: businessId, phone_e164: n.phoneNumber, twilio_number_sid: n.sid, status: "number_ready", updated_at: new Date().toISOString() }),
    "save number",
  );
}

/** After Meta's Embedded Signup returns the WhatsApp Business Account id: register the sender. */
export async function registerSender(admin: SupabaseClient, businessId: string, wabaId: string, displayName: string) {
  const line = await getLine(admin, businessId);
  if (!line?.phone) throw new Error("Get a number first");
  // The SDK sends this object as-is, so it uses the API's snake_case field names.
  const sender = await twilioClient().messaging.v2.channelsSenders.create({
    sender_id: waAddress(line.phone),
    configuration: { waba_id: wabaId },
    webhook: { callback_url: webhookUrl(), callback_method: "POST" },
    profile: { name: displayName },
  } as never);
  must(
    await admin
      .from("whatsapp_lines")
      .update({ sender_sid: sender.sid, waba_id: wabaId, display_name: displayName, status: lineStatusFromSender(sender.status), last_error: null, updated_at: new Date().toISOString() })
      .eq("business_id", businessId),
    "save sender",
  );
}

/** Pulls the sender's and templates' current status from Twilio. */
export async function refreshLine(admin: SupabaseClient, businessId: string) {
  const line = await getLine(admin, businessId);
  if (!line?.senderSid) return line;
  const client = twilioClient();
  const s = await client.messaging.v2.channelsSenders(line.senderSid).fetch();
  await admin.from("whatsapp_lines").update({ status: lineStatusFromSender(s.status), updated_at: new Date().toISOString() }).eq("business_id", businessId);
  const { data: templates } = await admin.from("whatsapp_templates").select("template_key, content_sid, status").eq("business_id", businessId).neq("status", "approved");
  for (const t of templates ?? []) {
    const a = await client.content.v1.contents(t.content_sid).approvalFetch().fetch();
    const status = String((a.whatsapp as { status?: string })?.status ?? "").toLowerCase();
    if (status === "approved" || status === "rejected") {
      await admin.from("whatsapp_templates").update({ status, updated_at: new Date().toISOString() }).eq("business_id", businessId).eq("template_key", t.template_key);
    }
  }
  return getLine(admin, businessId);
}

/** Creates the starter templates (Content API) and submits them to WhatsApp for approval. */
export async function submitStarterTemplates(admin: SupabaseClient, businessId: string, slug: string) {
  const client = twilioClient();
  const { data: have } = await admin.from("whatsapp_templates").select("template_key").eq("business_id", businessId);
  const done = new Set((have ?? []).map((t) => t.template_key));
  let submitted = 0;
  for (const [key, t] of Object.entries(STARTER_TEMPLATES)) {
    if (done.has(key)) continue;
    // Sent as-is by the SDK: API field names ("friendly_name", "twilio/text").
    const content = await client.content.v1.contents.create({
      friendly_name: `${slug}_${t.name}`.slice(0, 64),
      language: "en",
      variables: t.variables,
      types: { "twilio/text": { body: t.body } },
    } as never);
    await client.content.v1.contents(content.sid).approvalCreate.create({
      name: `${slug.replace(/-/g, "_")}_${t.name}`.slice(0, 512),
      category: t.category,
    } as never);
    await admin.from("whatsapp_templates").upsert({ business_id: businessId, template_key: key, content_sid: content.sid, status: "pending" });
    submitted++;
  }
  return submitted;
}

export async function approvedTemplate(admin: SupabaseClient, businessId: string, key: string): Promise<string | null> {
  const { data } = await admin.from("whatsapp_templates").select("content_sid").eq("business_id", businessId).eq("template_key", key).eq("status", "approved").maybeSingle();
  return data?.content_sid ?? null;
}

/**
 * A text message (SMS) from the business's number (the same Twilio number as its WhatsApp line).
 * With a `key`, sent at most once (automations retry).
 */
export async function sendSms(admin: SupabaseClient, businessId: string, to: string, body: string, opts: { key?: string } = {}): Promise<{ sid: string }> {
  if (await isTestBusiness(admin, businessId)) {
    await admin.from("outbound_messages").upsert({ business_id: businessId, key: opts.key ?? `sms:${Date.now()}`, channel: "sms", to_address: to, body_text: body.slice(0, 2000), status: "captured" }, { onConflict: "business_id,key", ignoreDuplicates: true });
    return { sid: "captured" };
  }
  const line = await getLine(admin, businessId);
  if (!line?.phone) throw new Error("This business has no phone number for texts yet");
  if (opts.key) {
    const ins = await admin
      .from("outbound_messages")
      .upsert({ business_id: businessId, key: opts.key, channel: "sms", to_address: to, body_text: body.slice(0, 2000) }, { onConflict: "business_id,key", ignoreDuplicates: true })
      .select("id");
    if (ins.error) throw new Error(ins.error.message);
    if (!ins.data?.length) {
      const prev = await admin.from("outbound_messages").select("status, provider_id").eq("business_id", businessId).eq("key", opts.key).single();
      if (prev.data?.status === "sent") return { sid: prev.data.provider_id };
    }
  }
  const msg = await twilioClient().messages.create({ from: line.phone, to, body: body.slice(0, 1500) });
  if (opts.key) await admin.from("outbound_messages").update({ status: "sent", provider_id: msg.sid, sent_at: new Date().toISOString() }).eq("business_id", businessId).eq("key", opts.key);
  return { sid: msg.sid };
}
