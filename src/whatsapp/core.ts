/**
 * Pure WhatsApp rules: phone numbers, Twilio's whatsapp: addresses, the 24-hour customer
 * service window, inbound message parsing, and the starter templates we submit for approval.
 */

/** Best-effort E.164: keeps a leading +, strips spaces/dashes/brackets; adds +1 for 10-digit NANP numbers. */
export function toE164(raw: string, defaultCountry = "1"): string | null {
  const s = raw.replace(/^whatsapp:/, "").trim();
  const digits = s.replace(/[^\d]/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && defaultCountry === "1") return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export const waAddress = (e164: string) => `whatsapp:${e164}`;

/** WhatsApp only allows free-form replies within 24 hours of the customer's last message. */
export const SESSION_WINDOW_MS = 24 * 3_600_000;
export const inSessionWindow = (lastInboundAt: string | null | undefined, now = new Date()) =>
  !!lastInboundAt && now.getTime() - Date.parse(lastInboundAt) < SESSION_WINDOW_MS;

/** The fields we use from Twilio's inbound webhook (application/x-www-form-urlencoded). */
export interface InboundWhatsApp {
  messageSid: string;
  from: string; // E.164 of the customer
  to: string; // E.164 of the business line
  body: string;
  profileName: string | null;
  numMedia: number;
}

export function parseInbound(params: Record<string, string>): InboundWhatsApp | null {
  const from = toE164(params.From ?? "");
  const to = toE164(params.To ?? "");
  if (!params.MessageSid || !from || !to || !(params.From ?? "").startsWith("whatsapp:")) return null;
  return {
    messageSid: params.MessageSid,
    from,
    to,
    body: (params.Body ?? "").slice(0, 4000),
    profileName: params.ProfileName?.slice(0, 100) || null,
    numMedia: Number(params.NumMedia ?? 0) || 0,
  };
}

/** Starter templates submitted for each business (business-initiated messages need approved templates). */
export const STARTER_TEMPLATES: Record<string, { name: string; category: "UTILITY" | "MARKETING"; body: string; variables: Record<string, string> }> = {
  tpl_reminder: {
    name: "appointment_reminder",
    category: "UTILITY",
    body: "Hi {{1}}, this is a reminder of your appointment at {{2}} on {{3}}. Reply here if you need to change it.",
    variables: { "1": "Ava", "2": "Polished Nail Bar", "3": "Tue, Dec 1 at 10:00" },
  },
  tpl_rebook: {
    name: "rebooking_nudge",
    category: "MARKETING",
    body: "Hi {{1}}, it’s been a few weeks since your last visit to {{2}}. Would you like to book your next appointment? Just reply here.",
    variables: { "1": "Ava", "2": "Polished Nail Bar" },
  },
  tpl_review: {
    name: "review_request",
    category: "MARKETING",
    body: "Hi {{1}}, thank you for visiting {{2}}! If you have a minute, a review helps us a lot: {{3}}",
    variables: { "1": "Ava", "2": "Polished Nail Bar", "3": "https://g.page/r/example/review" },
  },
  tpl_rent_due: {
    name: "rent_reminder",
    category: "UTILITY",
    body: "Hi {{1}}, a friendly reminder from {{2}} that your rent is due on {{3}}.",
    variables: { "1": "Sam", "2": "Studio 9", "3": "Fri, Dec 4" },
  },
  tpl_doc_expiry: {
    name: "document_expiring",
    category: "UTILITY",
    body: "Hi {{1}}, one of your documents with {{2}} expires soon. Please send us an updated copy.",
    variables: { "1": "Sam", "2": "Studio 9" },
  },
  tpl_shipped: {
    name: "order_shipped",
    category: "UTILITY",
    body: "Hi {{1}}, your order from {{2}} has shipped. {{3}}",
    variables: { "1": "Ava", "2": "Glass Co", "3": "Tracking: 1Z999" },
  },
};

/** Ordered variables for a template from what automations know about the record. */
export function templateVariables(templateId: string, v: { name?: string; business: string; when?: string; reviewLink?: string; tracking?: string }): Record<string, string> {
  const name = v.name || "there";
  switch (templateId) {
    case "tpl_reminder":
    case "tpl_rent_due":
      return { "1": name, "2": v.business, "3": v.when ?? "" };
    case "tpl_review":
      return { "1": name, "2": v.business, "3": v.reviewLink ?? "" };
    case "tpl_shipped":
      return { "1": name, "2": v.business, "3": v.tracking ? `Tracking: ${v.tracking}` : "" };
    default:
      return { "1": name, "2": v.business };
  }
}

export type LineStatus = "none" | "number_ready" | "registering" | "online" | "offline" | "failed";

/** Twilio sender status → ours. */
export function lineStatusFromSender(s: string | null | undefined): LineStatus {
  if (!s) return "registering";
  if (s === "ONLINE" || s === "ONLINE:UPDATING") return "online";
  if (s === "OFFLINE") return "offline";
  return "registering";
}
