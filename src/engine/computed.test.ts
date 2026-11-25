import { describe, expect, it } from "vitest";
import { addComputed } from "./computed";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import type { RecordRow } from "@/schema/records";

const bp = Blueprint.parse({
  ...demoBlueprint,
  business: { ...demoBlueprint.business, timezone: "UTC" },
  tables: [
    ...demoBlueprint.tables,
    { id: "tbl_rooms", label: "Rooms", primaryField: "fld_name", fields: [
      { id: "fld_name", label: "Name", type: "text" },
      { id: "fld_open_jobs", label: "Open repairs", type: "rollup", from: "tbl_jobs", via: "fld_room", field: "fld_title", agg: "count", where: [{ field: "fld_status", op: "neq", value: "opt_done" }] },
      { id: "fld_rent_status", label: "Rent", type: "rollup", from: "tbl_rent", via: "fld_rent_room", field: "fld_paid", agg: "latest", sortBy: "fld_due", where: [{ field: "fld_due", op: "lte", value: "@today" }] },
      { id: "fld_rent_total", label: "Rent billed", type: "rollup", from: "tbl_rent", via: "fld_rent_room", field: "fld_amount", agg: "sum" },
    ] },
    { id: "tbl_jobs", label: "Jobs", fields: [
      { id: "fld_title", label: "Title", type: "text" },
      { id: "fld_room", label: "Room", type: "link", to: "tbl_rooms" },
      { id: "fld_status", label: "Status", type: "status", options: [{ id: "opt_open", label: "Open" }, { id: "opt_done", label: "Done" }] },
    ] },
    { id: "tbl_rent", label: "Rent", fields: [
      { id: "fld_rent_room", label: "Room", type: "link", to: "tbl_rooms" },
      { id: "fld_due", label: "Due", type: "date" },
      { id: "fld_paid", label: "Paid", type: "checkbox" },
      { id: "fld_amount", label: "Amount", type: "number" },
    ] },
  ],
});

const row = (tableId: string, id: string, data: Record<string, unknown>): RecordRow => ({ id, tableId, data, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
const all: RecordRow[] = [
  row("tbl_jobs", "j1", { fld_room: "r1", fld_status: "opt_open" }),
  row("tbl_jobs", "j2", { fld_room: "r1", fld_status: "opt_done" }),
  row("tbl_jobs", "j3", { fld_room: "r2", fld_status: "opt_done" }),
  row("tbl_rent", "p1", { fld_rent_room: "r1", fld_due: "2026-10-01", fld_paid: true, fld_amount: 900 }),
  row("tbl_rent", "p2", { fld_rent_room: "r1", fld_due: "2026-11-01", fld_paid: false, fld_amount: 900 }),
  row("tbl_rent", "p3", { fld_rent_room: "r1", fld_due: "2026-12-01", fld_paid: false, fld_amount: 900 }),
];

describe("rollups computed on read", () => {
  it("counts filtered child records, takes the latest due value, sums", async () => {
    const rooms = [row("tbl_rooms", "r1", { fld_name: "Room 1" }), row("tbl_rooms", "r2", { fld_name: "Room 2" })];
    const out = await addComputed(bp, "tbl_rooms", rooms, async (t) => all.filter((r) => r.tableId === t), new Date("2026-11-25T12:00:00Z"));
    expect(out[0].data).toMatchObject({ fld_open_jobs: 1, fld_rent_status: false, fld_rent_total: 2700 });
    expect(out[1].data).toMatchObject({ fld_open_jobs: 0, fld_rent_status: null, fld_rent_total: 0 });
  });
  it("rejects a rollup whose link doesn't point back at the table", () => {
    const bad = structuredClone(bp) as unknown as { tables: { fields: { via?: string }[] }[] };
    bad.tables[demoBlueprint.tables.length].fields[1].via = "fld_title";
    expect(Blueprint.safeParse(bad).success).toBe(false);
  });
});
