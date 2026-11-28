import type { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { recordLabel } from "./blockData";

/**
 * Invoices as a spreadsheet an accountant (or QuickBooks / Xero's import) can take: one row per
 * invoice line, with the invoice's number, dates, customer and tax. Only sent invoices — drafts
 * aren't owed yet.
 */
const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote anything with a comma, quote or newline; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function invoicesCsv(
  bp: Blueprint,
  invoices: RecordRow[],
  lines: RecordRow[],
  customers: Map<string, RecordRow>,
  period: { from: string; to: string },
): string | null {
  const def = bp.documents?.find((d) => d.kind === "invoice");
  if (!def) return null;
  const custField = bp.tables.find((x) => x.id === def.table)?.fields.find((f) => f.id === def.customer);
  const cTable = custField?.type === "link" ? bp.tables.find((t) => t.id === custField.to) : undefined;
  const emailField = cTable?.fields.find((f) => f.type === "email");
  const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");
  const rows: unknown[][] = [["InvoiceNo", "Customer", "Email", "InvoiceDate", "DueDate", "Description", "Quantity", "UnitPrice", "Amount", "TaxRate", "Status"]];
  for (const inv of invoices) {
    const issued = day(def.issued ? inv.data[def.issued] : inv.createdAt) || day(inv.createdAt);
    if (def.sent && !inv.data[def.sent]) continue;
    if (issued < period.from || issued > period.to) continue;
    const cust = customers.get(String(inv.data[def.customer]));
    const mine = lines.filter((l) => l.data[def.lines.via] === inv.id);
    const taxRate = def.taxRate ? inv.data[def.taxRate] ?? "" : "";
    const status = Number(def.totals.balance ? inv.data[def.totals.balance] : NaN) <= 0.005 ? "Paid" : "Open";
    for (const l of mine.length ? mine : [null]) {
      rows.push([
        def.number ? inv.data[def.number] ?? "" : inv.id.slice(0, 8),
        cust && cTable ? recordLabel(cTable, cust) : "",
        cust && emailField ? cust.data[emailField.id] ?? "" : "",
        issued,
        def.due ? day(inv.data[def.due]) : "",
        l ? l.data[def.lines.description] ?? "" : "",
        l && def.lines.qty ? l.data[def.lines.qty] ?? 1 : 1,
        l && def.lines.price ? l.data[def.lines.price] ?? "" : "",
        l ? l.data[def.lines.total] ?? "" : inv.data[def.totals.total] ?? "",
        taxRate,
        status,
      ]);
    }
  }
  return toCsv(rows);
}
