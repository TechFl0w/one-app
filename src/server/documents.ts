import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blueprint, DocumentDef } from "@/schema/blueprint";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptPatch, documentById, documentFor, invoiceFromQuote, loadDocument, paymentRecord, type DocView } from "@/engine/documents";
import { isoDate, localToday } from "@/engine/dates";
import { withComputed } from "@/engine/computed";
import { getCurrentBlueprint } from "./blueprints";
import { supabaseStore } from "./store";
import { createRecord, getRecord, listRecords, updateRecord } from "./records";
import { createCheckout } from "./payments";
import { ensureEmailSettings, sendEmail } from "./email";

/**
 * Quotes and invoices on the server: private customer links (/d/<token>), accepting and paying
 * from them, sending, and turning an accepted quote into an invoice.
 */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
const todayIn = (bp: Blueprint) => isoDate(localToday(new Date(), bp.business.timezone));

/** The customer link for a document (made once, then reused). Server only: the caller checked access. */
export async function ensureDocumentLink(admin: SupabaseClient, businessId: string, documentId: string, recordId: string): Promise<string> {
  const found = await admin.from("document_links").select("token").eq("business_id", businessId).eq("document_id", documentId).eq("record_id", recordId).maybeSingle();
  if (found.data?.token) return found.data.token as string;
  const token = randomBytes(24).toString("base64url");
  const ins = await admin.from("document_links").upsert({ token, business_id: businessId, document_id: documentId, record_id: recordId }, { onConflict: "business_id,document_id,record_id", ignoreDuplicates: true });
  if (ins.error) throw new Error(`Could not make the link: ${ins.error.message}`);
  const again = await admin.from("document_links").select("token").eq("business_id", businessId).eq("document_id", documentId).eq("record_id", recordId).single();
  return again.data!.token as string;
}

export const documentUrl = (token: string) => `${appUrl()}/d/${token}`;

/** What a customer link shows. Null when the link (or the document) is gone. */
export async function publicDocument(token: string, opts: { viewed?: boolean } = {}): Promise<{ view: DocView; def: DocumentDef; businessId: string; bp: Blueprint } | null> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const admin = createAdminClient("public");
  const { data: link } = await admin.from("document_links").select("business_id, document_id, record_id").eq("token", token).maybeSingle();
  if (!link) return null;
  const bp = await getCurrentBlueprint(admin, link.business_id);
  const def = documentById(bp, link.document_id);
  if (!def) return null;
  const store = withComputed(supabaseStore(admin, link.business_id), bp);
  const [rec] = await store.getMany(def.table, [link.record_id]);
  if (!rec) return null;
  if (opts.viewed) await admin.from("document_links").update({ last_viewed_at: new Date().toISOString() }).eq("token", token);
  return { view: await loadDocument(bp, def, rec, store, todayIn(bp)), def, businessId: link.business_id, bp };
}

/** The customer accepts (with their name) or declines a quote from its link. */
export async function decideFromLink(token: string, decision: "accept" | "decline", name: string): Promise<DocView> {
  const doc = await publicDocument(token);
  if (!doc) throw new Error("This link no longer works.");
  if (!doc.view.canAccept) throw new Error(doc.view.state === "expired" ? "This quote has expired — ask for a new one." : "This quote can’t be changed anymore.");
  if (decision === "accept" && name.trim().length < 2) throw new Error("Type your name to accept.");
  const admin = createAdminClient("public");
  await updateRecord(admin, doc.businessId, doc.def.table, doc.view.id, acceptPatch(doc.def, decision, name, todayIn(doc.bp)), { confirmed: true });
  return (await publicDocument(token))!.view;
}

/** A Stripe payment page for what's still owed on an invoice. */
export async function payFromLink(token: string): Promise<string> {
  const doc = await publicDocument(token);
  if (!doc) throw new Error("This link no longer works.");
  if (!doc.view.canPay) throw new Error(doc.view.state === "paid" ? "This invoice is already paid — thank you!" : "This invoice can’t be paid online.");
  const { url } = await createCheckout(createAdminClient("public"), {
    kind: "payment",
    amount: Math.round((doc.view.balance ?? doc.view.total) * 100) / 100,
    currency: doc.view.business.currency,
    description: `${doc.view.label} ${doc.view.number ?? ""}`.trim(),
    businessId: doc.businessId,
    tableId: doc.def.table,
    recordId: doc.view.id,
    successUrl: `${documentUrl(token)}?paid=1`,
    cancelUrl: documentUrl(token),
    customerEmail: doc.view.customer.email,
  });
  return url;
}

/** A paid online payment for an invoice shows up as a payment record on it (balance updates). */
export async function recordDocumentPayment(admin: SupabaseClient, p: { business_id: string; table_id: string | null; record_id: string | null; amount: number | string }) {
  if (!p.table_id || !p.record_id) return;
  const bp = await getCurrentBlueprint(admin, p.business_id);
  const def = documentFor(bp, p.table_id);
  if (!def?.pay) return;
  const payTable = bp.tables.find((t) => t.id === def.pay!.table);
  if (!payTable) return;
  await createRecord(admin, p.business_id, payTable.id, paymentRecord(def, p.record_id, Number(p.amount), todayIn(bp), payTable));
}

/**
 * Sends a document: makes its link, marks it sent (first time), and emails the customer when
 * they have an email address. Returns the link so it can also be shared by hand.
 */
export async function sendDocument(supabase: SupabaseClient, businessId: string, tableId: string, recordId: string): Promise<{ link: string; emailed: boolean; reason?: string }> {
  const bp = await getCurrentBlueprint(supabase, businessId);
  const def = documentFor(bp, tableId);
  if (!def) throw new Error("This isn’t a quote or invoice.");
  await getRecord(supabase, businessId, tableId, recordId, bp); // the caller can see it (RLS)
  const admin = createAdminClient();
  const token = await ensureDocumentLink(admin, businessId, def.id, recordId);
  const store = withComputed(supabaseStore(supabase, businessId), bp);
  const [rec] = await store.getMany(tableId, [recordId]);
  const view = await loadDocument(bp, def, rec, store, todayIn(bp));
  if (!view.lines.length) throw new Error(`Add at least one line before sending the ${def.label.toLowerCase()}.`);
  if (def.sent && !view.sent) await updateRecord(supabase, businessId, tableId, recordId, { [def.sent]: todayIn(bp) }, { confirmed: true });
  const link = documentUrl(token);
  if (!view.customer.email) return { link, emailed: false, reason: "The customer has no email address — share the link another way." };
  const settings = await ensureEmailSettings(admin, businessId, bp.business.name);
  const ask = def.kind === "quote" ? "You can read it and accept it here" : "You can view and pay it here";
  const r = await sendEmail(admin, settings, {
    to: view.customer.email,
    subject: `${def.label} ${view.number ?? ""} from ${bp.business.name}`.replace(/\s+/g, " "),
    text: `Hi ${view.customer.name.split(" ")[0]},\n\n${ask}:\n${link}\n\n${view.title ? `${view.title}\n` : ""}Total: ${new Intl.NumberFormat("en-CA", { style: "currency", currency: view.business.currency }).format(view.balance ?? view.total)}\n\nThank you,\n${bp.business.name}`,
    key: `doc:${def.id}:${recordId}:${new Date().toISOString().slice(0, 16)}`,
  });
  return r.sent ? { link, emailed: true } : { link, emailed: false, reason: r.reason };
}

/** An invoice made from an accepted quote (lines copied). Returns the new invoice's id. */
export async function createInvoiceFromQuote(supabase: SupabaseClient, businessId: string, quoteTable: string, quoteId: string): Promise<{ table: string; id: string }> {
  const bp = await getCurrentBlueprint(supabase, businessId);
  const quote = documentFor(bp, quoteTable);
  const invoice = bp.documents?.find((d) => d.kind === "invoice" && d.from?.document === quote?.id);
  if (!quote || quote.kind !== "quote" || !invoice) throw new Error("There’s no invoice set up for this quote.");
  const q = await getRecord(supabase, businessId, quoteTable, quoteId, bp);
  if (quote.accept && !q.data[quote.accept.acceptedOn]) throw new Error("The quote hasn’t been accepted yet.");
  const existing = await listRecords(supabase, businessId, { table: invoice.table, filters: [{ field: invoice.from!.link, op: "eq", value: quoteId }], limit: 1 });
  if (existing.records[0]) return { table: invoice.table, id: existing.records[0].id };
  const lines = await listRecords(supabase, businessId, { table: quote.lines.table, filters: [{ field: quote.lines.via, op: "eq", value: quoteId }], sort: [{ field: "_created_at", dir: "asc" }], limit: 500 });
  const made = invoiceFromQuote(bp, invoice, quote, q, lines.records);
  const inv = await createRecord(supabase, businessId, invoice.table, made.invoice);
  for (const l of made.lines) await createRecord(supabase, businessId, invoice.lines.table, { ...l, [invoice.lines.via]: inv.id });
  return { table: invoice.table, id: inv.id };
}
