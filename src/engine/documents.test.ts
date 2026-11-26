import { describe, expect, it } from "vitest";
import { contractor } from "@/templates/contractor";
import { resolveSeed } from "@/templates/types";
import { memoryStore } from "./store";
import { withComputed } from "./computed";
import { acceptPatch, assignNumber, documentById, formatNumber, invoiceFromQuote, loadDocument, paymentRecord } from "./documents";
import { validateRecordInput, tableOrThrow } from "./records";

const TODAY = "2026-11-26";
const { blueprint: bp, seed } = contractor.build({ name: "Greenline Landscaping", timezone: "America/Vancouver" }, {});
const ids = new Map<string, string>();
const rows = seed.map((s, i) => {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const row = { id, tableId: s.table, data: resolveSeed(s.data, ids), createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
  if (s.ref) ids.set(s.ref, id);
  return row;
});
const store = withComputed(memoryStore(rows), bp);
const quote = documentById(bp, "doc_quote")!;
const invoice = documentById(bp, "doc_invoice")!;
const rec = async (table: string, ref: string) => (await store.getMany(table, [ids.get(ref)!]))[0];

describe("documents", () => {
  it("numbers new quotes and invoices, keeps a number someone typed", async () => {
    expect(formatNumber("Q-", 7)).toBe("Q-0007");
    expect(await assignNumber(bp, "tbl_quotes", { fld_q_title: "x" }, async () => 12)).toMatchObject({ fld_q_number: "Q-0012" });
    expect(await assignNumber(bp, "tbl_quotes", { fld_q_number: "A-1" }, async () => 12)).toMatchObject({ fld_q_number: "A-1" });
    expect(await assignNumber(bp, "tbl_clients", { fld_c_name: "x" }, async () => 12)).toEqual({ fld_c_name: "x" });
  });

  it("a sent quote shows its lines grouped, totals with tax, and can be accepted", async () => {
    const v = await loadDocument(bp, quote, await rec("tbl_quotes", "q1"), store, TODAY);
    expect(v.state).toBe("sent");
    expect(v.customer).toMatchObject({ name: "Priya Shah", email: "priya@example.com" });
    expect(v.lines.map((l) => l.group)).toContain("Materials");
    const sub = v.lines.reduce((a, l) => a + l.total, 0);
    expect(v.totals.map((t) => t.label)).toEqual(["Subtotal", "Tax", "Total"]);
    expect(v.total).toBeCloseTo(sub * 1.05, 2);
    expect(v.canAccept).toBe(true);
    expect(v.canPay).toBe(false);
  });

  it("accepted quotes can't be accepted again; past their date they expire", async () => {
    const accepted = await loadDocument(bp, quote, await rec("tbl_quotes", "q2"), store, TODAY);
    expect(accepted.state).toBe("accepted");
    expect(accepted.accepted).toMatchObject({ by: "Tom Becker" });
    expect(accepted.canAccept).toBe(false);
    const q1 = await rec("tbl_quotes", "q1");
    const expired = await loadDocument(bp, quote, { ...q1, data: { ...q1.data, fld_q_valid: "2026-11-01" } }, store, TODAY);
    expect(expired.state).toBe("expired");
    expect(expired.canAccept).toBe(false);
  });

  it("accepting records the date and name (the status follows)", () => {
    expect(acceptPatch(quote, "accept", " Priya Shah ", TODAY)).toEqual({ fld_q_accepted: TODAY, fld_q_accepted_by: "Priya Shah" });
    expect(acceptPatch(quote, "decline", "", TODAY)).toEqual({ fld_q_declined: TODAY });
    expect(() => acceptPatch(invoice, "accept", "x", TODAY)).toThrow();
  });

  it("an overdue invoice shows what was paid and what's left, and can be paid online", async () => {
    const v = await loadDocument(bp, invoice, await rec("tbl_invoices", "i1"), store, TODAY);
    expect(v.state).toBe("overdue");
    expect(v.totals.map((t) => t.label)).toEqual(["Subtotal", "Tax", "Total", "Paid", "Balance"]);
    expect(v.balance).toBeCloseTo(v.total - 100, 2);
    expect(v.canPay).toBe(true);
  });

  it("a paid online payment becomes a valid payment record on the invoice", () => {
    const pay = bp.tables.find((t) => t.id === "tbl_payments")!;
    const data = paymentRecord(invoice, ids.get("i1")!, 482.749, TODAY, pay);
    expect(data).toMatchObject({ fld_pay_invoice: ids.get("i1"), fld_pay_amount: 482.75, fld_pay_on: TODAY, fld_pay_title: "Paid online" });
    expect(() => validateRecordInput(pay, data, "create")).not.toThrow();
  });

  it("an invoice from a quote copies its client, job, site and every line", async () => {
    const q = await rec("tbl_quotes", "q1");
    const lines = rows.filter((r) => r.tableId === "tbl_quote_lines" && r.data.fld_ql_parent === q.id);
    const made = invoiceFromQuote(bp, invoice, quote, q, lines);
    expect(made.invoice).toMatchObject({ fld_i_client: q.data.fld_q_client, fld_i_title: q.data.fld_q_title, fld_i_quote: q.id, fld_i_job: q.data.fld_q_job, fld_i_site: q.data.fld_q_site });
    expect(made.lines).toHaveLength(lines.length);
    for (const l of made.lines) expect(() => validateRecordInput(tableOrThrow(bp, "tbl_invoice_lines"), { ...l, fld_il_parent: q.id }, "create")).not.toThrow();
  });
});
