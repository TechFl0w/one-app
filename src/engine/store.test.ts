import { describe, expect, it } from "vitest";
import { buildAggregate, buildRecordQuery, RecordError } from "./records";
import { memoryAggregate, memoryQuery } from "./store";
import { demoBlueprint, demoRecords } from "@/demo/salon";

const rows = demoRecords();
const names = (ids: string[]) => ids.map((id) => rows.find((r) => r.id === id)!.data.fld_amount);

describe("memory store on demo data", () => {
  it("finds today's bookings in the business timezone", () => {
    const p = buildRecordQuery(demoBlueprint, {
      table: "tbl_bookings",
      filters: [{ field: "fld_start", op: "eq", value: "@today" }],
      sort: [{ field: "fld_start", dir: "asc" }],
    });
    expect(p.p_filters.map((f) => f.op)).toEqual(["gte", "lt"]);
    const r = memoryQuery(rows, p);
    expect(r.total).toBe(5);
    expect(names(r.records.map((x) => x.id))).toEqual([55, 48, 55, 15, 55]);
  });

  it("aggregates", () => {
    const sum = buildAggregate(demoBlueprint, {
      table: "tbl_bookings",
      agg: "sum",
      field: "fld_amount",
      filters: [{ field: "fld_start", op: "eq", value: "@today" }],
    });
    expect(memoryAggregate(rows, sum)).toBe(228);
    expect(memoryAggregate(rows, buildAggregate(demoBlueprint, { table: "tbl_bookings" }))).toBe(7);
  });

  it("rejects date tokens on non-date fields and sums of text fields", () => {
    expect(() => buildRecordQuery(demoBlueprint, { table: "tbl_bookings", filters: [{ field: "fld_amount", op: "eq", value: "@today" }] })).toThrow(RecordError);
    expect(() => buildRecordQuery(demoBlueprint, { table: "tbl_bookings", filters: [{ field: "fld_start", op: "neq", value: "@today" }] })).toThrow(/does not support/);
    expect(() => buildAggregate(demoBlueprint, { table: "tbl_bookings", agg: "sum", field: "fld_notes" })).toThrow(/number or money/);
  });
});
