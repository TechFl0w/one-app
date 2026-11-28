import type { Blueprint, DocumentDef, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { recordLabel } from "./blockData";
import { readable } from "@/automations/check";
import { buildRecordQuery } from "./records";
import type { RecordStore } from "./store";
import { isoDate, localToday } from "./dates";
import { valueMatches } from "./computed";

/**
 * Quotes and invoices (blueprint.documents): what a customer sees, built from ordinary records —
 * the document's record, its lines and its customer. Pure apart from the store.
 */

export const documentFor = (bp: Blueprint, tableId: string): DocumentDef | undefined => bp.documents?.find((d) => d.table === tableId);
export const documentById = (bp: Blueprint, id: string): DocumentDef | undefined => bp.documents?.find((d) => d.id === id);

export interface DocLine {
  id: string;
  group?: string;
  description: string;
  qty?: number;
  unit?: string;
  price?: number;
  total: number;
}

export interface DocView {
  id: string;
  kind: DocumentDef["kind"];
  label: string;
  number?: string;
  title?: string;
  intro?: string;
  terms?: string;
  issued: string;
  due?: string;
  sent?: string;
  /** Extra fields the owner chose to show (label and value as text). */
  extra: { label: string; value: string }[];
  customer: { name: string; email?: string; phone?: string; address?: string };
  business: { name: string; currency: string; timezone: string };
  lines: DocLine[];
  totals: { label: string; value: number; strong?: boolean }[];
  total: number;
  balance?: number;
  accepted?: { on: string; by?: string };
  declined?: { on: string };
  /** What the customer can do now (and why not). */
  canAccept: boolean;
  canPay: boolean;
  state: "draft" | "sent" | "accepted" | "declined" | "expired" | "paid" | "overdue";
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const optionLabel = (f: Field | undefined, v: unknown) => (f && (f.type === "status" || f.type === "choice") ? f.options.find((o) => o.id === v)?.label : undefined);

/** "Q-" + 7 → "Q-0007". */
export const formatNumber = (prefix: string | undefined, n: number) => `${prefix ?? ""}${String(n).padStart(4, "0")}`;

/**
 * Gives a new document its number when it has none. `next` returns the next counter value for
 * the document (a database sequence, or a count in memory).
 */
export async function assignNumber(bp: Blueprint, tableId: string, data: Record<string, unknown>, next: (docId: string) => Promise<number>): Promise<Record<string, unknown>> {
  const def = documentFor(bp, tableId);
  if (!def) return data;
  let out = data;
  // New quotes and invoices charge the business's sales tax unless a rate was given.
  if (def.taxRate && (out[def.taxRate] === undefined || out[def.taxRate] === null) && bp.business.taxRate) out = { ...out, [def.taxRate]: bp.business.taxRate };
  if (def.number && !str(out[def.number])) out = { ...out, [def.number]: formatNumber(def.prefix, await next(def.id)) };
  return out;
}

function documentState(def: DocumentDef, rec: RecordRow, today: string): DocView["state"] {
  const d = rec.data;
  if (def.kind === "quote") {
    if (def.accept && str(d[def.accept.acceptedOn])) return "accepted";
    if (def.accept?.declinedOn && str(d[def.accept.declinedOn])) return "declined";
    if (def.due && str(d[def.due]) && String(d[def.due]).slice(0, 10) < today) return "expired";
    return def.sent && !str(d[def.sent]) ? "draft" : "sent";
  }
  const total = num(d[def.totals.total]) ?? 0;
  const balance = def.totals.balance ? num(d[def.totals.balance]) : undefined;
  if (total > 0 && balance !== undefined && balance <= 0.004) return "paid";
  if (def.due && str(d[def.due]) && String(d[def.due]).slice(0, 10) < today) return "overdue";
  return def.sent && !str(d[def.sent]) ? "draft" : "sent";
}

/** Everything the document page shows, from the record (with computed values) and its lines. */
export async function loadDocument(bp: Blueprint, def: DocumentDef, rec: RecordRow, store: RecordStore, today: string): Promise<DocView> {
  const table = bp.tables.find((t) => t.id === def.table)!;
  const linesTable = bp.tables.find((t) => t.id === def.lines.table)!;
  const d = rec.data;
  const { records: lineRows } = await store.query(buildRecordQuery(bp, { table: linesTable.id, filters: [{ field: def.lines.via, op: "eq", value: rec.id }], sort: [{ field: "_created_at", dir: "asc" }], limit: 500 }, {}));
  const customerField = table.fields.find((f) => f.id === def.customer);
  const customerId = typeof d[def.customer] === "string" ? (d[def.customer] as string) : undefined;
  const customerTable = customerField?.type === "link" ? bp.tables.find((t) => t.id === customerField.to) : undefined;
  const [customer] = customerTable && customerId ? await store.getMany(customerTable.id, [customerId]) : [];
  const groupField = def.lines.group ? linesTable.fields.find((f) => f.id === def.lines.group) : undefined;
  const lines: DocLine[] = lineRows.map((l) => ({
    id: l.id,
    description: String(l.data[def.lines.description] ?? ""),
    total: num(l.data[def.lines.total]) ?? 0,
    ...(def.lines.qty && num(l.data[def.lines.qty]) !== undefined ? { qty: num(l.data[def.lines.qty]) } : {}),
    ...(def.lines.unit && str(l.data[def.lines.unit]) ? { unit: optionLabel(linesTable.fields.find((f) => f.id === def.lines.unit), l.data[def.lines.unit]) ?? String(l.data[def.lines.unit]) } : {}),
    ...(def.lines.price && num(l.data[def.lines.price]) !== undefined ? { price: num(l.data[def.lines.price]) } : {}),
    ...(groupField && l.data[groupField.id] ? { group: optionLabel(groupField, l.data[groupField.id]) ?? String(l.data[groupField.id]) } : {}),
  }));
  const label = (id: string | undefined, fallback: string) => table.fields.find((f) => f.id === id)?.label ?? fallback;
  const totals: DocView["totals"] = [];
  const t = def.totals;
  if (t.subtotal && num(d[t.subtotal]) !== undefined) totals.push({ label: label(t.subtotal, "Subtotal"), value: num(d[t.subtotal])! });
  if (t.tax && num(d[t.tax]) !== undefined) totals.push({ label: label(t.tax, "Tax"), value: num(d[t.tax])! });
  const total = num(d[t.total]) ?? lines.reduce((a, l) => a + l.total, 0);
  totals.push({ label: label(t.total, "Total"), value: total, strong: true });
  if (t.paid && num(d[t.paid])) totals.push({ label: label(t.paid, "Paid"), value: -num(d[t.paid])! });
  const balance = t.balance ? num(d[t.balance]) : undefined;
  if (t.balance && balance !== undefined && t.paid && num(d[t.paid])) totals.push({ label: label(t.balance, "Balance due"), value: balance, strong: true });
  const fieldOf = (pred: (f: Field) => boolean) => customerTable?.fields.find(pred);
  const email = customer && fieldOf((f) => f.type === "email") ? str(customer.data[fieldOf((f) => f.type === "email")!.id]) : undefined;
  const phone = customer && fieldOf((f) => f.type === "phone") ? str(customer.data[fieldOf((f) => f.type === "phone")!.id]) : undefined;
  const addressField = fieldOf((f) => (f.type === "text" || f.type === "long_text") && /address/i.test(f.label));
  const address = customer && addressField ? str(customer.data[addressField.id]) : undefined;
  const state = documentState(def, rec, today);
  const acceptedOn = def.accept ? str(d[def.accept.acceptedOn]) : undefined;
  const declinedOn = def.accept?.declinedOn ? str(d[def.accept.declinedOn]) : undefined;
  return {
    id: rec.id,
    kind: def.kind,
    label: def.label,
    number: def.number ? str(d[def.number]) : undefined,
    title: def.title ? str(d[def.title]) : undefined,
    intro: def.intro ? str(d[def.intro]) : undefined,
    terms: (def.terms ? str(d[def.terms]) : undefined) ?? def.footer,
    issued: (def.issued ? str(d[def.issued]) : undefined) ?? (def.sent ? str(d[def.sent]) : undefined) ?? rec.createdAt,
    due: def.due ? str(d[def.due]) : undefined,
    sent: def.sent ? str(d[def.sent]) : undefined,
    extra: (def.show ?? [])
      .map((id) => table.fields.find((f) => f.id === id))
      .filter((f): f is Field => !!f && d[f.id] != null && d[f.id] !== "")
      .map((f) => ({ label: f.label, value: readable(f, d[f.id], bp) }))
      .filter((x) => x.value),
    customer: { name: customer && customerTable ? recordLabel(customerTable, customer) : "—", ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(address ? { address } : {}) },
    business: { name: bp.business.name, currency: bp.business.currency ?? "CAD", timezone: bp.business.timezone },
    lines,
    totals,
    total,
    ...(balance !== undefined ? { balance } : {}),
    ...(acceptedOn ? { accepted: { on: acceptedOn, ...(def.accept?.acceptedBy && str(d[def.accept.acceptedBy]) ? { by: str(d[def.accept.acceptedBy]) } : {}) } } : {}),
    ...(declinedOn ? { declined: { on: declinedOn } } : {}),
    canAccept: def.kind === "quote" && !!def.accept && (state === "sent" || state === "draft") && lines.length > 0,
    canPay: def.kind === "invoice" && !!def.pay && state !== "paid" && (balance ?? total) >= 0.5,
    state,
  };
}

/** The record changes when the customer accepts (or declines) a quote. */
export function acceptPatch(def: DocumentDef, decision: "accept" | "decline", name: string, today: string): Record<string, unknown> {
  if (!def.accept) throw new Error("This document can't be accepted online");
  if (decision === "decline") {
    if (!def.accept.declinedOn) throw new Error("This document can't be declined online");
    return { [def.accept.declinedOn]: today };
  }
  return { [def.accept.acceptedOn]: today, ...(def.accept.acceptedBy ? { [def.accept.acceptedBy]: name.trim().slice(0, 200) } : {}) };
}

/** The record a paid online payment adds to the invoice's payments. */
export function paymentRecord(def: DocumentDef, invoiceId: string, amount: number, today: string, payTable: Table): Record<string, unknown> {
  const p = def.pay!;
  const method = p.method ? payTable.fields.find((f) => f.id === p.method) : undefined;
  const card = p.card ?? (method && (method.type === "status" || method.type === "choice") ? method.options.find((o) => /card|online|stripe/i.test(o.label))?.id : undefined);
  return {
    [p.via]: invoiceId,
    [p.amount]: Math.round(amount * 100) / 100,
    [p.date]: today,
    ...(p.title ? { [p.title]: "Paid online" } : {}),
    ...(method && card ? { [method.id]: card } : {}),
  };
}

/**
 * An invoice from an accepted quote: its customer, title and scope, and a copy of every line
 * (the invoice can then be edited freely; the quote stays as accepted).
 */
export function invoiceFromQuote(
  bp: Blueprint,
  invoice: DocumentDef,
  quote: DocumentDef,
  q: RecordRow,
  quoteLines: RecordRow[],
  opts: { depositPercent?: number; earlier?: { number?: string; subtotal: number }[] } = {},
): { invoice: Record<string, unknown>; lines: Record<string, unknown>[] } {
  const qTable = bp.tables.find((t) => t.id === quote.table)!;
  const iTable = bp.tables.find((t) => t.id === invoice.table)!;
  const copy = (from: string | undefined, to: string | undefined, out: Record<string, unknown>) => {
    if (from && to && q.data[from] != null && q.data[from] !== "") out[to] = q.data[from];
  };
  const data: Record<string, unknown> = {};
  copy(quote.customer, invoice.customer, data);
  copy(quote.title, invoice.title, data);
  copy(quote.intro, invoice.intro, data);
  if (invoice.from) data[invoice.from.link] = q.id;
  // Other plain fields both tables share by label (a site, a job) come along too.
  for (const f of qTable.fields) {
    if (f.type !== "link" || f.id === quote.customer) continue;
    const g = iTable.fields.find((x) => x.type === "link" && x.label === f.label && x.to === f.to && !(x.id in data));
    if (g && q.data[f.id]) data[g.id] = q.data[f.id];
  }
  const ql = quote.lines;
  const il = invoice.lines;
  const subtotal = (quote.totals.subtotal ? Number(q.data[quote.totals.subtotal]) : NaN) || quoteLines.reduce((a, l) => a + (Number(l.data[ql.total]) || 0), 0);
  const qNumber = quote.number && typeof q.data[quote.number] === "string" ? ` ${q.data[quote.number]}` : "";
  const oneLine = (description: string, price: number) => ({ [il.description]: description, ...(il.qty ? { [il.qty]: 1 } : {}), ...(il.price ? { [il.price]: Math.round(price * 100) / 100 } : {}) });
  // A deposit invoice: one line, a share of the quote.
  if (opts.depositPercent) {
    const pct = Math.min(Math.max(opts.depositPercent, 1), 100);
    if (invoice.title && data[invoice.title]) data[invoice.title] = `${data[invoice.title]} — deposit`;
    return { invoice: data, lines: [oneLine(`Deposit (${pct}%) for quote${qNumber}`, (subtotal * pct) / 100)] };
  }
  const lines: Record<string, unknown>[] = quoteLines.map((l) => {
    const out: Record<string, unknown> = {};
    const c = (from: string | undefined, to: string | undefined) => from && to && l.data[from] != null && (out[to] = l.data[from]);
    c(ql.description, il.description);
    c(ql.qty, il.qty);
    c(ql.unit, il.unit);
    c(ql.price, il.price);
    c(ql.group, il.group);
    return out;
  });
  // The final invoice takes off what was invoiced before (the deposit).
  for (const e of opts.earlier ?? []) if (e.subtotal > 0) lines.push(oneLine(`Less already invoiced${e.number ? ` (${e.number})` : ""}`, -e.subtotal));
  return { invoice: data, lines };
}

type InvoiceBackend = { query(q: RecordQueryInput): Promise<{ records: RecordRow[]; total: number }>; getRecord(t: string, id: string): Promise<RecordRow>; createRecord(t: string, v: Record<string, unknown>): Promise<RecordRow> };
type RecordQueryInput = { table: string; filters?: { field: string; op: "eq"; value: string }[]; sort?: { field: string; dir: "asc" | "desc" }[]; limit?: number };

/**
 * An invoice for an accepted quote, through any backend (the app's button, the assistant, the
 * MCP tool): the full amount (minus earlier invoices for it, e.g. the deposit), or a deposit.
 */
export async function makeInvoiceFromQuote(bp: Blueprint, b: InvoiceBackend, quoteTable: string, quoteId: string, opts: { depositPercent?: number } = {}): Promise<{ table: string; id: string; number?: string; total?: number }> {
  const quote = documentFor(bp, quoteTable);
  const invoice = bp.documents?.find((d) => d.kind === "invoice" && d.from?.document === quote?.id);
  if (!quote || quote.kind !== "quote" || !invoice) throw new Error("There’s no invoice set up for this quote.");
  const q = await b.getRecord(quoteTable, quoteId);
  if (quote.accept && !q.data[quote.accept.acceptedOn]) throw new Error("The quote hasn’t been accepted yet.");
  const subtotalOf = (r: RecordRow) => Number(invoice.totals.subtotal ? r.data[invoice.totals.subtotal] : r.data[invoice.totals.total]) || 0;
  const earlier = (await b.query({ table: invoice.table, filters: [{ field: invoice.from!.link, op: "eq", value: quoteId }], sort: [{ field: "_created_at", dir: "asc" }], limit: 50 })).records;
  const quoteSubtotal = Number(quote.totals.subtotal ? q.data[quote.totals.subtotal] : q.data[quote.totals.total]) || 0;
  const invoiced = earlier.reduce((a, r) => a + subtotalOf(r), 0);
  if (earlier.length && invoiced >= quoteSubtotal - 0.005) {
    const last = earlier[earlier.length - 1];
    return { table: invoice.table, id: last.id, number: invoice.number ? String(last.data[invoice.number] ?? "") : undefined };
  }
  const lines = (await b.query({ table: quote.lines.table, filters: [{ field: quote.lines.via, op: "eq", value: quoteId }], sort: [{ field: "_created_at", dir: "asc" }], limit: 500 })).records;
  const made = invoiceFromQuote(bp, invoice, quote, q, lines, {
    depositPercent: opts.depositPercent,
    earlier: opts.depositPercent ? [] : earlier.map((r) => ({ number: invoice.number ? String(r.data[invoice.number] ?? "") : undefined, subtotal: subtotalOf(r) })),
  });
  const inv = await b.createRecord(invoice.table, made.invoice);
  for (const l of made.lines) await b.createRecord(invoice.lines.table, { ...l, [invoice.lines.via]: inv.id });
  const fresh = await b.getRecord(invoice.table, inv.id);
  return { table: invoice.table, id: inv.id, number: invoice.number ? String(fresh.data[invoice.number] ?? "") : undefined, total: Number(fresh.data[invoice.totals.total]) || undefined };
}

/**
 * An invoice for a period's work: every finished, not-yet-invoiced record of `def.bill` for the
 * customer between `from` and `to` (dates, inclusive) becomes a line, and is linked to the new
 * invoice so it's never billed twice.
 */
export async function invoiceWork(
  bp: Blueprint,
  b: InvoiceBackend & { updateRecord(table: string, id: string, values: Record<string, unknown>, opts?: { confirmed?: boolean }): Promise<unknown> },
  invoiceTable: string,
  customerId: string,
  period: { from: string; to: string },
  now = new Date(),
): Promise<{ table: string; id: string; number?: string; total?: number; count: number } | { count: 0 }> {
  const def = documentFor(bp, invoiceTable);
  const bill = def?.bill;
  if (!def || def.kind !== "invoice" || !bill) throw new Error("Invoicing work isn’t set up here.");
  const tz = bp.business.timezone;
  const wt = bp.tables.find((t) => t.id === bill.table);
  if (!wt) throw new Error("Invoicing work isn’t set up here.");
  const dayOf = (v: unknown) => (typeof v !== "string" ? "" : v.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)) : v.slice(0, 10));
  const today = isoDate(localToday(now, tz));
  const work = (await b.query({ table: bill.table, filters: [{ field: bill.customer, op: "eq", value: customerId }], limit: 500 })).records
    .filter((r) => !r.data[bill.invoice])
    .filter((r) => { const d = dayOf(r.data[bill.date]); return d >= period.from && d <= period.to; })
    .filter((r) => (bill.done ?? []).every((w) => valueMatches(r.data[w.field], w, today, now, tz)))
    .sort((x, y) => String(x.data[bill.date]).localeCompare(String(y.data[bill.date])));
  if (!work.length) return { count: 0 };
  const fmtDay = (d: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const il = def.lines;
  const label = (r: RecordRow) => (bill.description && r.data[bill.description] ? String(r.data[bill.description]) : wt.label.replace(/s$/, ""));
  const month = period.from.slice(0, 7) === period.to.slice(0, 7) ? new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period.from}T12:00:00Z`)) : `${fmtDay(period.from)} – ${fmtDay(period.to)}`;
  const inv = await b.createRecord(def.table, { [def.customer]: customerId, ...(def.title ? { [def.title]: `${wt.label} — ${month}` } : {}) });
  for (const r of work) {
    const amount = Number(r.data[bill.amount]) || 0;
    await b.createRecord(il.table, { [il.via]: inv.id, [il.description]: `${label(r)} — ${fmtDay(dayOf(r.data[bill.date]))}`, ...(il.qty ? { [il.qty]: 1 } : {}), ...(il.price ? { [il.price]: Math.round(amount * 100) / 100 } : {}) });
    await b.updateRecord(bill.table, r.id, { [bill.invoice]: inv.id }, { confirmed: true });
  }
  const fresh = await b.getRecord(def.table, inv.id);
  return { table: def.table, id: inv.id, number: def.number ? String(fresh.data[def.number] ?? "") : undefined, total: Number(fresh.data[def.totals.total]) || undefined, count: work.length };
}
