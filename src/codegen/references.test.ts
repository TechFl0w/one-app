import { describe, expect, it } from "vitest";
import { checkReferences } from "./references";
import { demoBlueprint } from "@/demo/salon";

describe("component reference check", () => {
  it("accepts ids that exist", () => {
    expect(checkReferences('useRecords({ table: "tbl_bookings", filters: [{ field: "fld_status", op: "eq", value: "opt_booked" }] }); navigate("pg_today")', demoBlueprint)).toEqual([]);
  });
  it("flags unknown tables, fields, options and pages", () => {
    const errors = checkReferences('useRecords({ table: "tbl_nope" }); x["fld_typo"]; s === "opt_gone"; navigate(`pg_missing`)', demoBlueprint);
    expect(errors.join("\n")).toMatch(/table tbl_nope/);
    expect(errors.join("\n")).toMatch(/field fld_typo/);
    expect(errors.join("\n")).toMatch(/choice option opt_gone/);
    expect(errors.join("\n")).toMatch(/page pg_missing/);
  });
  it("allows the page being created, and ignores ids built at runtime", () => {
    expect(checkReferences('navigate("pg_new"); const f = "fld_" + key;', demoBlueprint, ["pg_new"])).toEqual([]);
  });
  it("flags a field used with the wrong table", () => {
    const clientField = demoBlueprint.tables.find((t) => t.id === "tbl_clients")!.fields.find((f) => !demoBlueprint.tables.find((t) => t.id === "tbl_bookings")!.fields.some((g) => g.id === f.id))!.id;
    expect(checkReferences(`useRecords({ table: "tbl_bookings", sort: [{ field: "${clientField}", dir: "asc" }] })`, demoBlueprint)[0]).toMatch(/isn't on table tbl_bookings/);
  });
});
