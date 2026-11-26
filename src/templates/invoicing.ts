import type { DocumentDef, Field, Table } from "@/schema/blueprint";
import { COLORS, date, derived, link, longText, money, num, optId, status, text } from "./kit";

/**
 * Quotes (scope of work the customer accepts online) and invoices (they pay online), for any
 * business: tables, lines, payments and the two documents. Every status is derived from dates
 * and amounts (docs/data-rules.md), every total is computed.
 */

const S = optId;
const rollup = (f: Omit<Extract<Field, { type: "rollup" }>, "type">): Field => ({ type: "rollup", ...f }) as Field;
const formula = (id: string, label: string, expression: string, format: "money" | "number" = "money"): Field => ({ id, label, type: "formula", expression, format });

export const LINE_KINDS: [string, string][] = [["Labour", COLORS.BLUE], ["Materials", COLORS.AMBER], ["Equipment", "#6B46C1"], ["Other", COLORS.GREY]];
export const UNITS: [string][] = [["hr"], ["each"], ["m²"], ["m"], ["day"], ["job"]];

export interface InvoicingOptions {
  /** The customers table (its link field is "Client"). */
  customers: string;
  /** Other records quotes and invoices belong to, e.g. [{ table: "tbl_jobs", label: "Job" }]. */
  links?: { table: string; label: string; id: string }[];
  /** Default tax rate on new documents, in percent. */
  taxRate?: number;
  /** Small print on quotes and on invoices. */
  quoteTerms?: string;
  invoiceTerms?: string;
}

function lineTable(id: string, label: string, parent: string, p: string, parentLabel: string): Table {
  return {
    id,
    label,
    primaryField: `fld_${p}_desc`,
    openIn: "modal",
    fields: [
      text(`fld_${p}_desc`, "Description", true),
      link(`fld_${p}_parent`, parentLabel, parent, { required: true }),
      status(`fld_${p}_kind`, "Kind", LINE_KINDS, "choice"),
      { ...num(`fld_${p}_qty`, "Qty"), required: true, min: 0 } as Field,
      status(`fld_${p}_unit`, "Unit", UNITS, "choice"),
      { ...money(`fld_${p}_price`, "Unit price"), required: true } as Field,
      formula(`fld_${p}_total`, "Amount", `round(fld_${p}_qty * fld_${p}_price, 2)`),
    ],
  };
}

export function invoicingTables(o: InvoicingOptions): { tables: Table[]; documents: DocumentDef[] } {
  const links = o.links ?? [];
  const tax = (p: string) => ({ ...num(`fld_${p}_tax_rate`, "Tax rate (%)"), min: 0, max: 100 }) as Field;
  const sums = (p: string, lines: string, lp: string) => [
    rollup({ id: `fld_${p}_subtotal`, label: "Subtotal", from: lines, via: `fld_${lp}_parent`, field: `fld_${lp}_total`, agg: "sum", format: "money" }),
    formula(`fld_${p}_tax`, "Tax", `round(fld_${p}_subtotal * fld_${p}_tax_rate / 100, 2)`),
    formula(`fld_${p}_total`, "Total", `fld_${p}_subtotal + round(fld_${p}_subtotal * fld_${p}_tax_rate / 100, 2)`),
  ];
  const quotes: Table = {
    id: "tbl_quotes",
    label: "Quotes",
    primaryField: "fld_q_title",
    fields: [
      text("fld_q_title", "Title", true),
      text("fld_q_number", "Quote #"),
      link("fld_q_client", "Client", o.customers, { required: true }),
      ...links.map((l) => link(`fld_q_${l.id}`, l.label, l.table)),
      longText("fld_q_scope", "Scope of work"),
      date("fld_q_valid", "Valid until"),
      tax("q"),
      ...sums("q", "tbl_quote_lines", "ql"),
      // Facts: when it was sent, accepted (and by whom) or declined. The status follows them.
      date("fld_q_sent", "Sent on"),
      date("fld_q_accepted", "Accepted on"),
      text("fld_q_accepted_by", "Accepted by"),
      date("fld_q_declined", "Declined on"),
      derived(status("fld_q_status", "Status", [["Draft", COLORS.GREY], ["Sent", COLORS.BLUE], ["Accepted", COLORS.GREEN], ["Declined", COLORS.GREY], ["Expired", COLORS.AMBER]]), [
        [[{ field: "fld_q_accepted", op: "not_empty" }], "Accepted"],
        [[{ field: "fld_q_declined", op: "not_empty" }], "Declined"],
        [[{ field: "fld_q_sent", op: "empty" }], "Draft"],
        [[{ field: "fld_q_valid", op: "lt", value: "@today" }], "Expired"],
      ], "Sent"),
      longText("fld_q_terms", "Terms"),
    ],
  };
  const invoices: Table = {
    id: "tbl_invoices",
    label: "Invoices",
    primaryField: "fld_i_title",
    fields: [
      text("fld_i_title", "Title", true),
      text("fld_i_number", "Invoice #"),
      link("fld_i_client", "Client", o.customers, { required: true }),
      ...links.map((l) => link(`fld_i_${l.id}`, l.label, l.table)),
      link("fld_i_quote", "From quote", "tbl_quotes"),
      longText("fld_i_notes", "Notes"),
      date("fld_i_issued", "Issued"),
      date("fld_i_due", "Due"),
      tax("i"),
      ...sums("i", "tbl_invoice_lines", "il"),
      rollup({ id: "fld_i_paid", label: "Paid", from: "tbl_payments", via: "fld_pay_invoice", field: "fld_pay_amount", agg: "sum", format: "money" }),
      formula("fld_i_balance", "Balance", "fld_i_subtotal + round(fld_i_subtotal * fld_i_tax_rate / 100, 2) - fld_i_paid"),
      date("fld_i_sent", "Sent on"),
      derived(status("fld_i_status", "Status", [["Draft", COLORS.GREY], ["Sent", COLORS.BLUE], ["Overdue", COLORS.RED], ["Paid", COLORS.GREEN]]), [
        [[{ field: "fld_i_subtotal", op: "gt", value: 0 }, { field: "fld_i_balance", op: "lte", value: 0 }], "Paid"],
        [[{ field: "fld_i_sent", op: "empty" }], "Draft"],
        [[{ field: "fld_i_due", op: "lt", value: "@today" }], "Overdue"],
      ], "Sent"),
    ],
  };
  const payments: Table = {
    id: "tbl_payments",
    label: "Payments",
    primaryField: "fld_pay_title",
    openIn: "modal",
    fields: [
      text("fld_pay_title", "Payment", true),
      link("fld_pay_invoice", "Invoice", "tbl_invoices", { required: true }),
      { ...money("fld_pay_amount", "Amount"), required: true } as Field,
      status("fld_pay_method", "Method", [["Card"], ["E-transfer"], ["Cash"], ["Cheque"], ["Other"]], "choice"),
      date("fld_pay_on", "Paid on", true),
    ],
  };
  const line = (p: string) => ({ via: `fld_${p}_parent`, description: `fld_${p}_desc`, qty: `fld_${p}_qty`, unit: `fld_${p}_unit`, price: `fld_${p}_price`, total: `fld_${p}_total`, group: `fld_${p}_kind` });
  const documents: DocumentDef[] = [
    {
      id: "doc_quote",
      kind: "quote",
      label: "Quote",
      table: "tbl_quotes",
      number: "fld_q_number",
      prefix: "Q-",
      customer: "fld_q_client",
      title: "fld_q_title",
      intro: "fld_q_scope",
      terms: "fld_q_terms",
      ...(o.quoteTerms ? { footer: o.quoteTerms } : {}),
      due: "fld_q_valid",
      sent: "fld_q_sent",
      lines: { table: "tbl_quote_lines", ...line("ql") },
      totals: { subtotal: "fld_q_subtotal", tax: "fld_q_tax", total: "fld_q_total" },
      accept: { acceptedOn: "fld_q_accepted", acceptedBy: "fld_q_accepted_by", declinedOn: "fld_q_declined" },
    },
    {
      id: "doc_invoice",
      kind: "invoice",
      label: "Invoice",
      table: "tbl_invoices",
      number: "fld_i_number",
      prefix: "INV-",
      customer: "fld_i_client",
      title: "fld_i_title",
      intro: "fld_i_notes",
      ...(o.invoiceTerms ? { footer: o.invoiceTerms } : {}),
      issued: "fld_i_issued",
      due: "fld_i_due",
      sent: "fld_i_sent",
      lines: { table: "tbl_invoice_lines", ...line("il") },
      totals: { subtotal: "fld_i_subtotal", tax: "fld_i_tax", total: "fld_i_total", paid: "fld_i_paid", balance: "fld_i_balance" },
      pay: { table: "tbl_payments", via: "fld_pay_invoice", amount: "fld_pay_amount", date: "fld_pay_on", title: "fld_pay_title", method: "fld_pay_method", card: S("Card") },
      from: { document: "doc_quote", link: "fld_i_quote" },
    },
  ];
  return {
    tables: [quotes, lineTable("tbl_quote_lines", "Quote lines", "tbl_quotes", "ql", "Quote"), invoices, lineTable("tbl_invoice_lines", "Invoice lines", "tbl_invoices", "il", "Invoice"), payments],
    documents,
  };
}

export const QUOTE = (label: string) => S(label);
