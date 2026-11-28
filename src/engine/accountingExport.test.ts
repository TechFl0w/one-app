import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/templates";
import { memoryBackend } from "@/agent/memoryBackend";
import { invoicesCsv, toCsv } from "./accountingExport";

describe("accounting export", () => {
  it("quotes cells and defuses formulas", () => {
    expect(toCsv([["a,b", 'say "hi"', "=SUM(A1)", -5]])).toBe('"a,b","say ""hi""",\'=SUM(A1),-5\r\n');
  });
  it("one row per line of each sent invoice in the period", async () => {
    const bp = TEMPLATES.find((t) => t.id === "contractor")!.build({ name: "Green Edge", timezone: "America/Vancouver" }, {}).blueprint;
    const { backend } = memoryBackend({ blueprint: bp, records: [] });
    const c = await backend.createRecord("tbl_clients", { fld_c_name: "Sarah Whitfield", fld_c_email: "sarah@example.com" });
    const sent = await backend.createRecord("tbl_invoices", { fld_i_title: "Backyard", fld_i_client: c.id, fld_i_issued: "2026-11-10", fld_i_sent: "2026-11-10", fld_i_tax_rate: 5 });
    await backend.createRecord("tbl_invoice_lines", { fld_il_desc: "Sod", fld_il_parent: sent.id, fld_il_qty: 2, fld_il_price: 100 });
    await backend.createRecord("tbl_invoices", { fld_i_title: "Draft", fld_i_client: c.id, fld_i_issued: "2026-11-12" });
    const all = (t: string) => backend.query({ table: t, limit: 100 }).then((r) => r.records);
    const csv = invoicesCsv(bp, await all("tbl_invoices"), await all("tbl_invoice_lines"), new Map([[c.id, c]]), { from: "2026-11-01", to: "2026-11-30" })!;
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("INV-0001,Sarah Whitfield,sarah@example.com,2026-11-10,,Sod,2,100,200,5,Open");
  });
});
