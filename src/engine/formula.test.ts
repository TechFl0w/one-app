import { describe, expect, it } from "vitest";
import { evaluateFormula, parseFormula, FormulaError, formulaFields } from "./formula";
import { addComputed } from "./computed";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import type { RecordRow } from "@/schema/records";

const ev = (src: string, data: Record<string, unknown> = {}) => evaluateFormula(parseFormula(src), data);

describe("formulas", () => {
  it("does arithmetic over field values", () => {
    expect(ev("fld_qty * fld_price", { fld_qty: 2, fld_price: 12.5 })).toBe(25);
    expect(ev("fld_total - fld_paid", { fld_total: 300 })).toBe(300); // empty counts as 0
    expect(ev("round(fld_h * fld_rate, 2)", { fld_h: 1.333, fld_rate: 90 })).toBe(119.97);
    expect(ev("max(fld_in - fld_out, 0)", { fld_in: 3, fld_out: 5 })).toBe(0);
    expect(ev("if(fld_stock <= fld_min, 1, 0)", { fld_stock: 2, fld_min: 3 })).toBe(1);
    expect(ev("-(2 + 3) * 4 % 6")).toBe(-2);
    expect(ev("1 / 0")).toBeNull();
    expect(ev("0.1 + 0.2")).toBe(0.3);
  });

  it("rejects anything that isn't a formula", () => {
    for (const bad of ["", "fld_a +", "alert(1)", "fld_a; fld_b", "round()", "process.exit", "(1"]) expect(() => parseFormula(bad), bad).toThrow(FormulaError);
    expect([...formulaFields(parseFormula("fld_a * (fld_b + fld_a)"))]).toEqual(["fld_a", "fld_b"]);
  });

  const bp = Blueprint.parse({
    ...demoBlueprint,
    business: { ...demoBlueprint.business, timezone: "UTC" },
    tables: [
      ...demoBlueprint.tables,
      { id: "tbl_cust", label: "Customers", fields: [
        { id: "fld_c_name", label: "Name", type: "text" },
        { id: "fld_c_owed", label: "Owed", type: "rollup", from: "tbl_job", via: "fld_j_cust", field: "fld_j_balance", agg: "sum" },
      ] },
      { id: "tbl_job", label: "Jobs", fields: [
        { id: "fld_j_title", label: "Job", type: "text" },
        { id: "fld_j_cust", label: "Customer", type: "link", to: "tbl_cust" },
        { id: "fld_j_total", label: "Total", type: "rollup", from: "tbl_line", via: "fld_l_job", field: "fld_l_total", agg: "sum" },
        { id: "fld_j_paid", label: "Paid", type: "rollup", from: "tbl_pay", via: "fld_p_job", field: "fld_p_amount", agg: "sum" },
        { id: "fld_j_balance", label: "Balance", type: "formula", expression: "fld_j_total - fld_j_paid", format: "money" },
        { id: "fld_j_pay", label: "Payment", type: "status", options: [{ id: "opt_paid", label: "Paid" }, { id: "opt_owing", label: "Owing" }], derive: { rules: [{ when: [{ field: "fld_j_balance", op: "lte", value: 0 }], option: "opt_paid" }], otherwise: "opt_owing" } },
      ] },
      { id: "tbl_line", label: "Lines", fields: [
        { id: "fld_l_desc", label: "Line", type: "text" },
        { id: "fld_l_job", label: "Job", type: "link", to: "tbl_job" },
        { id: "fld_l_qty", label: "Qty", type: "number" },
        { id: "fld_l_price", label: "Price", type: "money" },
        { id: "fld_l_total", label: "Total", type: "formula", expression: "fld_l_qty * fld_l_price", format: "money" },
      ] },
      { id: "tbl_pay", label: "Payments", fields: [
        { id: "fld_p_ref", label: "Ref", type: "text" },
        { id: "fld_p_job", label: "Job", type: "link", to: "tbl_job" },
        { id: "fld_p_amount", label: "Amount", type: "money" },
      ] },
    ],
  });
  const row = (tableId: string, id: string, data: Record<string, unknown>): RecordRow => ({ id, tableId, data, createdAt: "", updatedAt: "" });
  const all = [
    row("tbl_job", "j1", { fld_j_cust: "c1" }),
    row("tbl_job", "j2", { fld_j_cust: "c1" }),
    row("tbl_line", "l1", { fld_l_job: "j1", fld_l_qty: 2, fld_l_price: 85 }),
    row("tbl_line", "l2", { fld_l_job: "j1", fld_l_qty: 1, fld_l_price: 180 }),
    row("tbl_line", "l3", { fld_l_job: "j2", fld_l_qty: 1, fld_l_price: 60 }),
    row("tbl_pay", "p1", { fld_p_job: "j1", fld_p_amount: 100 }),
    row("tbl_pay", "p2", { fld_p_job: "j2", fld_p_amount: 60 }),
  ];
  const load = async (t: string) => all.filter((r) => r.tableId === t);

  it("chains line totals → job totals → balance → payment status → customer balance", async () => {
    const jobs = await addComputed(bp, "tbl_job", all.filter((r) => r.tableId === "tbl_job"), load);
    expect(jobs.map((j) => [j.data.fld_j_total, j.data.fld_j_paid, j.data.fld_j_balance, j.data.fld_j_pay])).toEqual([[350, 100, 250, "opt_owing"], [60, 60, 0, "opt_paid"]]);
    const [cust] = await addComputed(bp, "tbl_cust", [row("tbl_cust", "c1", { fld_c_name: "Sam" })], load);
    expect(cust.data.fld_c_owed).toBe(250);
  });

  it("validates formulas in the setup", () => {
    const bad = structuredClone(bp);
    (bad.tables.find((t) => t.id === "tbl_line")!.fields[4] as { expression: string }).expression = "fld_l_qty * fld_nope";
    expect(Blueprint.safeParse(bad).error?.issues[0].message).toMatch(/unknown field fld_nope/);
  });
});
