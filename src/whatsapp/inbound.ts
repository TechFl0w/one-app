import type { InboundWhatsApp } from "./core";

/**
 * What happens when a customer messages a business on WhatsApp. Routing is decided here, in
 * code, before any model sees the text (CLAUDE.md rule 5): the number they wrote to picks the
 * business, their own number is their identity. Side effects are injected (Supabase + Twilio in
 * production, fakes in tests).
 */

export interface Conversation {
  id: string;
  businessId: string;
  customerPhone: string;
  /** Where the conversation happens: replies go back the same way. */
  channel: "whatsapp" | "sms";
  /** agent = the customer agent answers; owner = handed over, the owner answers. */
  mode: "agent" | "owner";
  history: unknown[];
}

export interface InboundDeps {
  /** Business whose number this is (WhatsApp: only lines that are online). */
  businessForNumber(e164: string, channel: "whatsapp" | "sms"): Promise<string | null>;
  conversation(businessId: string, customerPhone: string, profileName: string | null, channel: "whatsapp" | "sms"): Promise<Conversation>;
  /** Stores the message; false if this MessageSid was already stored (Twilio retries). */
  saveInbound(conv: Conversation, msg: InboundWhatsApp): Promise<boolean>;
  agentReply(conv: Conversation, msg: InboundWhatsApp): Promise<{ reply: string; history: unknown[]; escalated: string | null }>;
  /** Sends a free-form reply (we're inside the 24h window: they just wrote) and stores it. */
  send(conv: Conversation, body: string, author: "agent" | "owner"): Promise<void>;
  saveConversation(conv: Conversation, patch: Partial<Pick<Conversation, "mode" | "history">>): Promise<void>;
  notifyOwner(businessId: string, text: string, conv: Conversation): Promise<void>;
}

export type InboundOutcome = "ignored" | "duplicate" | "owner_notified" | "answered" | "escalated";

export async function handleInboundWhatsApp(msg: InboundWhatsApp, deps: InboundDeps): Promise<InboundOutcome> {
  const businessId = await deps.businessForNumber(msg.to, msg.channel);
  if (!businessId) return "ignored";
  const conv = await deps.conversation(businessId, msg.from, msg.profileName, msg.channel);
  if (!(await deps.saveInbound(conv, msg))) return "duplicate";

  const who = msg.profileName ? `${msg.profileName} (${msg.from})` : msg.from;
  if (conv.mode === "owner") {
    await deps.notifyOwner(businessId, `New ${msg.channel === "sms" ? "text" : "WhatsApp"} from ${who}: ${msg.body.slice(0, 140)}`, conv);
    return "owner_notified";
  }
  if (!msg.body.trim()) {
    await deps.send(conv, "Thanks! I can only read text messages here — could you type your question?", "agent");
    return "answered";
  }

  let result: Awaited<ReturnType<InboundDeps["agentReply"]>>;
  try {
    result = await deps.agentReply(conv, msg);
  } catch {
    // The assistant failed: don't leave the customer hanging, hand over.
    await deps.saveConversation(conv, { mode: "owner" });
    await deps.send(conv, "Thanks for your message — someone from the team will reply here shortly.", "agent");
    await deps.notifyOwner(businessId, `The assistant couldn’t answer ${who}. Please reply in the Inbox.`, conv);
    return "escalated";
  }
  await deps.send(conv, result.reply, "agent");
  if (result.escalated) {
    await deps.saveConversation(conv, { mode: "owner", history: result.history });
    await deps.notifyOwner(businessId, `${who} needs you on WhatsApp: ${result.escalated}`, conv);
    return "escalated";
  }
  await deps.saveConversation(conv, { history: result.history });
  return "answered";
}
