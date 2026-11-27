import type { Blueprint } from "@/schema/blueprint";

/**
 * Pure email helpers: addresses, the From/Reply-To rules from docs/integrations.md, templates,
 * and recipient lookup. Sending lives in src/server/email.ts.
 *
 * From is always the shared sending domain under the business's name — never the owner's own
 * address. Replies go to the owner's address or the business's inbound address.
 */

export interface EmailDomains {
  send: string; // e.g. mail.buildingwaves.tech
  inbound: string; // e.g. in.buildingwaves.tech
}

export function emailDomains(env: Record<string, string | undefined> = process.env): EmailDomains {
  return {
    send: env.EMAIL_SEND_DOMAIN || "mail.buildingwaves.tech",
    inbound: env.EMAIL_INBOUND_DOMAIN || "in.buildingwaves.tech",
  };
}

export interface EmailSettings {
  businessId: string;
  slug: string;
  fromName: string;
  replyMode: "owner" | "inbound";
  ownerEmail: string | null;
  forwardToOwner: boolean;
}

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
export const isEmail = (s: unknown): s is string => typeof s === "string" && EMAIL_RE.test(s.trim());

/** Lowercase, dashes, 3–40 chars: "Café Crème & Co" → "cafe-creme-co". */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return s.length >= 3 ? s : `biz-${s || "x"}`.slice(0, 32);
}

/** Display names can't break the header: no quotes, angle brackets or line breaks. */
export function safeDisplayName(name: string): string {
  return name.replace(/[\r\n"<>\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64) || "One App";
}

/** Subjects can't carry header injection. */
export const safeSubject = (s: string) => s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

export const inboundAddress = (slug: string, d: EmailDomains) => `${slug}@${d.inbound}`;

export interface OutboundEmail {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
}

export function composeEmail(s: EmailSettings, d: EmailDomains, msg: { to: string; subject: string; text: string; replyTo?: string }): OutboundEmail {
  if (!isEmail(msg.to)) throw new Error(`Not an email address: ${msg.to}`);
  const replyTo = msg.replyTo ?? (s.replyMode === "owner" && s.ownerEmail ? s.ownerEmail : inboundAddress(s.slug, d));
  return {
    from: `"${safeDisplayName(s.fromName)}" <hello@${d.send}>`,
    to: msg.to.trim(),
    replyTo,
    subject: safeSubject(msg.subject),
    text: msg.text,
    headers: { "X-One-Business": s.businessId },
  };
}

/** "Ava <ava@x.com>" → { name: "Ava", email: "ava@x.com" }. */
export function parseAddress(raw: string): { name: string | null; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

/** Which business an inbound email is for: the first recipient on our inbound domain. */
export function slugFromRecipients(recipients: string[], d: EmailDomains): string | null {
  for (const r of recipients) {
    const { email } = parseAddress(r);
    const [local, domain] = email.split("@");
    if (domain === d.inbound.toLowerCase() && /^[a-z0-9][a-z0-9-]{2,39}$/.test(local)) return local;
  }
  return null;
}

// ---------- templates ----------

/** Built-in message templates referenced by automations (owner-editable templates come later). */
export const EMAIL_TEMPLATES: Record<string, { subject: string; text: string }> = {
  tpl_reminder: { subject: "See you tomorrow at {{business}}", text: "Hi {{name}},\n\nJust a reminder of your appointment on {{when}}.\n\nNeed to cancel? {{manage_link}}\n\nReply to this email if you need to change it.\n\n{{business}}" },
  tpl_rebook: { subject: "Time for your next visit?", text: "Hi {{name}},\n\nIt’s been a few weeks — would you like to book your next appointment?\n\nBook online: {{booking_link}}\n\nOr just reply to this email.\n\n{{business}}" },
  tpl_review: { subject: "How was your visit to {{business}}?", text: "Hi {{name}},\n\nThank you for coming in! If you have a minute, a short review helps us a lot:\n{{review_link}}\n\n{{business}}" },
  tpl_thanks: { subject: "Thank you from {{business}}", text: "Hi {{name}},\n\nThank you for coming in. We hope to see you again soon!\n\n{{business}}" },
  tpl_shipped: { subject: "Your order is on its way", text: "Hi {{name}},\n\nGood news: your order has shipped.{{tracking}}\n\nThank you for your order!\n\n{{business}}" },
  tpl_rent_due: { subject: "Rent reminder", text: "Hi {{name}},\n\nA friendly reminder that your rent is due on {{when}}.\n\n{{business}}" },
  tpl_doc_expiry: { subject: "A document is about to expire", text: "Hi {{name}},\n\nOne of your documents expires soon. Please send us an updated copy.\n\n{{business}}" },
};

/**
 * Subject + text for an automation message: a known template id, else the step's own message,
 * else a short generic note. Placeholders: {{name}}, {{when}}, {{business}}, {{tracking}}, {{fld_x}}.
 */
export function renderTemplate(
  templateId: string | undefined,
  message: string | undefined,
  vars: { business: string; name?: string; when?: string; tracking?: string; reviewLink?: string; bookingLink?: string; documentLink?: string; manageLink?: string; data: Record<string, unknown> },
): { subject: string; text: string } {
  const known = templateId ? EMAIL_TEMPLATES[templateId] : undefined;
  const t = known ?? { subject: "A message from {{business}}", text: message ?? "Hi {{name}},\n\n{{business}}" };
  const fill = (s: string) =>
    s
      .replace(/\{\{\s*(business|business_name)\s*\}\}/g, vars.business)
      // A line with a link the business doesn't have (no booking page yet) is left out whole.
      .replace(/^(.*)\{\{\s*booking_link\s*\}\}(.*)$/gm, (_, a: string, b: string) => (vars.bookingLink ? `${a}${vars.bookingLink}${b}` : "\u0000"))
      .replace(/^(.*)\{\{\s*manage_link\s*\}\}(.*)$/gm, (_, a: string, b: string) => (vars.manageLink ? `${a}${vars.manageLink}${b}` : "\u0000"))
      .replace(/^(.*)\{\{\s*document_link\s*\}\}(.*)$/gm, (_, a: string, b: string) => (vars.documentLink ? `${a}${vars.documentLink}${b}` : "\u0000"))
      .replace(/\{\{\s*name\s*\}\}/g, vars.name || "there")
      .replace(/\{\{\s*when\s*\}\}/g, vars.when ?? "")
      .replace(/\{\{\s*tracking\s*\}\}/g, vars.tracking ? ` Tracking: ${vars.tracking}` : "")
      .replace(/\{\{\s*review_link\s*\}\}/g, vars.reviewLink ?? "")
      .replace(/\{\{\s*(fld_[a-z0-9_]+)\s*\}\}/g, (_, k: string) => (vars.data[k] == null ? "" : String(vars.data[k])));
  const clean = (x: string) => x.replace(/\n?\u0000\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return { subject: safeSubject(clean(fill(t.subject)).trim()), text: clean(fill(t.text)) };
}

// ---------- recipients ----------

/**
 * Who an automation's email goes to. `toField` is an email field on the record, or a link to a
 * record (client, customer, renter) whose first email field is used.
 */
export async function resolveRecipient(
  bp: Blueprint,
  tableId: string,
  data: Record<string, unknown>,
  toField: string | undefined,
  getRecord: (tableId: string, id: string) => Promise<Record<string, unknown> | null>,
): Promise<{ email: string; name?: string } | null> {
  const table = bp.tables.find((t) => t.id === tableId);
  if (!table) return null;
  const nameOf = (t: typeof table, d: Record<string, unknown>) => {
    const f = t.fields.find((x) => x.id === t.primaryField) ?? t.fields.find((x) => x.type === "text");
    return f && typeof d[f.id] === "string" ? (d[f.id] as string) : undefined;
  };
  const candidates = toField ? table.fields.filter((f) => f.id === toField) : table.fields.filter((f) => f.type === "email" || f.type === "link");
  for (const f of candidates) {
    if (f.type === "email" && isEmail(data[f.id])) return { email: String(data[f.id]).trim(), name: nameOf(table, data) };
    if (f.type === "link" && typeof data[f.id] === "string") {
      const target = bp.tables.find((t) => t.id === f.to);
      const linked = target && (await getRecord(target.id, data[f.id] as string));
      const emailField = target?.fields.find((x) => x.type === "email" && linked && isEmail(linked[x.id]));
      if (target && linked && emailField) return { email: String(linked[emailField.id]).trim(), name: nameOf(target, linked) };
    }
  }
  return null;
}
