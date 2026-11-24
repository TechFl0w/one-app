import { Webhook } from "standardwebhooks";
import { parseAddress, slugFromRecipients, type EmailDomains, type EmailSettings } from "./compose";

/**
 * Inbound email: Resend posts `email.received` (metadata only), we fetch the body through the
 * Receiving API, store it in the business's Inbox and forward it to the owner. Side effects are
 * injected so this is testable; src/server/email.ts wires the real ones.
 */

export interface ReceivedEventData {
  email_id: string;
  created_at: string;
  from: string;
  to: string[];
  received_for?: string[];
  subject: string;
}

export interface InboxRow {
  businessId: string;
  providerId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  receivedAt: string;
}

export interface InboundDeps {
  settingsBySlug(slug: string): Promise<EmailSettings | null>;
  fetchEmail(id: string): Promise<{ from: string; to: string[]; subject: string | null; text: string | null; html: string | null; created_at: string }>;
  /** Stores the message; false if it was already stored (webhooks are retried). */
  saveInbox(row: InboxRow): Promise<boolean>;
  forwardToOwner(settings: EmailSettings, row: InboxRow): Promise<void>;
}

/** Verifies a Resend (Standard Webhooks / Svix) signature. Throws if invalid or stale. */
export function verifyWebhook(rawBody: string, headers: Headers, secret: string): unknown {
  const h = (name: string) => headers.get(`svix-${name}`) ?? headers.get(`webhook-${name}`) ?? "";
  return new Webhook(secret).verify(rawBody, { "webhook-id": h("id"), "webhook-timestamp": h("timestamp"), "webhook-signature": h("signature") });
}

export type InboundOutcome = { status: "ignored"; reason: string } | { status: "duplicate" | "stored"; businessId: string; forwarded: boolean };

export async function handleReceived(data: ReceivedEventData, deps: InboundDeps, domains: EmailDomains): Promise<InboundOutcome> {
  const slug = slugFromRecipients([...(data.received_for ?? []), ...data.to], domains);
  if (!slug) return { status: "ignored", reason: "not addressed to an inbound address" };
  const settings = await deps.settingsBySlug(slug);
  if (!settings) return { status: "ignored", reason: `no business for ${slug}` };

  const full = await deps.fetchEmail(data.email_id);
  const from = parseAddress(full.from || data.from);
  const row: InboxRow = {
    businessId: settings.businessId,
    providerId: data.email_id,
    fromAddress: from.email,
    fromName: from.name,
    toAddresses: full.to?.length ? full.to : data.to,
    subject: full.subject ?? data.subject ?? null,
    text: full.text,
    html: full.html,
    receivedAt: full.created_at || data.created_at,
  };
  if (!(await deps.saveInbox(row))) return { status: "duplicate", businessId: settings.businessId, forwarded: false };

  // Don't bounce mail back to the owner who sent it, and only when forwarding is on.
  const forward = settings.forwardToOwner && !!settings.ownerEmail && settings.ownerEmail.toLowerCase() !== from.email;
  if (forward) await deps.forwardToOwner(settings, row);
  return { status: "stored", businessId: settings.businessId, forwarded: forward };
}

/** The forwarded copy: from the business's sending address, replies go straight to the customer. */
export function forwardedCopy(row: InboxRow) {
  const who = row.fromName ? `${row.fromName} <${row.fromAddress}>` : row.fromAddress;
  return {
    subject: `Fwd: ${row.subject ?? "(no subject)"}`,
    text: `New message to your business inbox.\nFrom: ${who}\n\nReply to this email to answer them directly.\n\n---\n\n${row.text ?? "(This message has no plain-text part; open it in the app Inbox.)"}`,
    replyTo: row.fromAddress,
  };
}
