import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { TEMPLATES } from "@/templates";
import { memoryBackend } from "@/agent/memoryBackend";
import { invoiceWork } from "./documents";

describe("invoice a period's work", () => {
  it("bills each finished, unbilled visit in the month once", async () => {
    const base = TEMPLATES.find((t) => t.id === "contractor")!.build({ name: "Spark Clean", timezone: "America/Vancouver" }, {}).blueprint;
    const bp = Blueprint.parse({
      ...base,
      tables: [
        ...base.tables,
        { id: "tbl_visits", label: "Visits", primaryField: "fld_v_what", fields: [
          { id: "fld_v_what", label: "What", type: "text" },
          { id: "fld_v_client", label: "Client", type: "link", to: "tbl_clients" },
          { id: "fld_v_on", label: "On", type: "datetime" },
          { id: "fld_v_price", label: "Price", type: "money" },
          { id: "fld_v_status", label: "Status", type: "status", options: [{ id: "opt_planned", label: "Planned" }, { id: "opt_done", label: "Done" }] },
          { id: "fld_v_invoice", label: "Invoice", type: "link", to: "tbl_invoices" },
        ] },
      ],
      documents: base.documents!.map((d) => (d.kind === "invoice" ? { ...d, bill: { table: "tbl_visits", customer: "fld_v_client", date: "fld_v_on", description: "fld_v_what", amount: "fld_v_price", invoice: "fld_v_invoice", done: [{ field: "fld_v_status", op: "eq", value: "opt_done" }] } } : d)),
    });
    const { backend } = memoryBackend({ blueprint: bp, records: [] });
    const hannah = await backend.createRecord("tbl_clients", { fld_c_name: "Hannah Lee" });
    const v = (on: string, status: string, what = "Standard clean") => backend.createRecord("tbl_visits", { fld_v_what: what, fld_v_client: hannah.id, fld_v_on: on, fld_v_price: 120, fld_v_status: status });
    await v("2026-11-03T17:00:00Z", "opt_done");
    await v("2026-11-17T17:00:00Z", "opt_done", "Deep clean");
    await v("2026-11-24T17:00:00Z", "opt_planned"); // not done yet
    await v("2026-12-01T17:00:00Z", "opt_done"); // next month
    const now = new Date("2026-11-30T20:00:00Z");
    const r = await invoiceWork(bp, backend, "tbl_invoices", hannah.id, { from: "2026-11-01", to: "2026-11-30" }, now);
    expect(r.count).toBe(2);
    if (!("id" in r)) throw new Error("no invoice");
    const inv = await backend.getRecord("tbl_invoices", r.id);
    expect(inv.data).toMatchObject({ fld_i_client: hannah.id, fld_i_title: "Visits — November 2026", fld_i_subtotal: 240 });
    const lines = (await backend.query({ table: "tbl_invoice_lines", limit: 10 })).records.map((l) => l.data.fld_il_desc).sort();
    expect(lines).toEqual(["Deep clean — Nov 17", "Standard clean — Nov 3"]);
    // Again: nothing left to bill.
    expect((await invoiceWork(bp, backend, "tbl_invoices", hannah.id, { from: "2026-11-01", to: "2026-11-30" }, now)).count).toBe(0);
  });
});
