import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { memoryBackend } from "@/agent/memoryBackend";

const bp = Blueprint.parse({
  version: 1,
  business: { name: "Bright Sparks", type: "electrician", timezone: "America/Vancouver" },
  tables: [
    { id: "tbl_rates", label: "Rates", primaryField: "fld_r_name", fields: [{ id: "fld_r_name", label: "Name", type: "text" }, { id: "fld_r_price", label: "Per hour", type: "money" }] },
    { id: "tbl_lines", label: "Lines", primaryField: "fld_l_desc", fields: [
      { id: "fld_l_desc", label: "Description", type: "text" },
      { id: "fld_l_rate", label: "Rate", type: "link", to: "tbl_rates" },
      { id: "fld_l_price", label: "Price", type: "money", fill: { from: "fld_l_rate", field: "fld_r_price" } },
    ] },
  ],
  pages: [], automations: [], connections: [], modules: [],
});

describe("fill from a linked record", () => {
  it("picking a rate fills the price; a typed price wins; changing the rate updates it", async () => {
    const { backend } = memoryBackend({ blueprint: bp, records: [] });
    const senior = await backend.createRecord("tbl_rates", { fld_r_name: "Senior", fld_r_price: 120 });
    const junior = await backend.createRecord("tbl_rates", { fld_r_name: "Junior", fld_r_price: 75 });
    const a = await backend.createRecord("tbl_lines", { fld_l_desc: "Panel upgrade", fld_l_rate: senior.id });
    expect(a.data.fld_l_price).toBe(120);
    const b = await backend.createRecord("tbl_lines", { fld_l_desc: "After hours", fld_l_rate: senior.id, fld_l_price: 150 });
    expect(b.data.fld_l_price).toBe(150);
    const c = await backend.updateRecord("tbl_lines", a.id, { fld_l_rate: junior.id }, { confirmed: true });
    expect(c.data.fld_l_price).toBe(75);
  });
});
