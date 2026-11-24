/**
 * The demo's in-memory store must behave like query_records / aggregate_records.
 * Loads the demo data into Postgres and runs the same queries through both.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAggregate, buildRecordQuery, type AggregateParams, type QueryRecordsParams } from "@/engine/records";
import { memoryAggregate, memoryQuery } from "@/engine/store";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import type { RecordQuery } from "@/schema/records";
import type { DataSource } from "@/schema/blueprint";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let biz: string;
const rows = demoRecords();
const bp = demoBlueprint;
const now = new Date();

async function sql(p: QueryRecordsParams) {
  return t.as(owner, async (c) => {
    const r = await c.query("select id, total from public.query_records($1, $2, $3::jsonb, $4::jsonb, $5, $6)", [
      biz, p.p_table_id, JSON.stringify(p.p_filters), JSON.stringify(p.p_sort), p.p_limit, p.p_offset,
    ]);
    return { ids: r.rows.map((x) => x.id as string), total: r.rows.length ? Number(r.rows[0].total) : 0 };
  });
}

async function sqlAgg(p: AggregateParams) {
  return t.as(owner, async (c) => {
    const r = await c.query("select public.aggregate_records($1, $2, $3::jsonb, $4, $5) as v", [
      biz, p.p_table_id, JSON.stringify(p.p_filters), p.p_agg, p.p_field,
    ]);
    return r.rows[0].v === null ? null : Number(r.rows[0].v);
  });
}

const queries: RecordQuery[] = [
  { table: "tbl_bookings" },
  { table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }] },
  { table: "tbl_bookings", sort: [{ field: "fld_amount", dir: "desc" }, { field: "fld_start", dir: "asc" }] },
  { table: "tbl_bookings", sort: [{ field: "fld_practitioner", dir: "asc" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_start", op: "eq", value: "@today" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_start", op: "gt", value: "@today" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_start", op: "lt", value: "@today" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_start", op: "eq", value: "@this_week" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_status", op: "neq", value: "opt_booked" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_practitioner", op: "empty" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_notes", op: "not_empty" }] },
  { table: "tbl_bookings", filters: [{ field: "fld_amount", op: "gte", value: 25 }, { field: "fld_amount", op: "lt", value: 55 }] },
  { table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }], limit: 2, offset: 3 },
  { table: "tbl_clients", filters: [{ field: "fld_name", op: "contains", value: "EL" }] },
  { table: "tbl_clients", filters: [{ field: "fld_vip", op: "eq", value: true }] },
  { table: "tbl_clients", filters: [{ field: "fld_vip", op: "neq", value: true }] },
  { table: "tbl_services", filters: [{ field: "fld_minutes", op: "lte", value: 20 }], sort: [{ field: "fld_price", dir: "asc" }] },
];

const aggregates: DataSource[] = [
  { table: "tbl_bookings", agg: "count" },
  { table: "tbl_bookings", agg: "sum", field: "fld_amount", filters: [{ field: "fld_start", op: "eq", value: "@today" }] },
  { table: "tbl_bookings", agg: "avg", field: "fld_amount" },
  { table: "tbl_bookings", agg: "max", field: "fld_amount", filters: [{ field: "fld_status", op: "eq", value: "opt_booked" }] },
  { table: "tbl_bookings", agg: "min", field: "fld_amount" },
  { table: "tbl_bookings", agg: "sum", field: "fld_amount", filters: [{ field: "fld_status", op: "eq", value: "opt_cancelled_nonexistent" }] },
];

describe.skipIf(!testDbUrl)("memory store ↔ SQL parity", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    owner = await t.newUser();
    biz = await t.createBusiness(owner, "Demo", demoBlueprint);
    await t.asCommit(owner, async (c) => {
      for (const r of rows) {
        await c.query("insert into public.records (id, business_id, table_id, data, created_at) values ($1, $2, $3, $4, $5)", [
          r.id, biz, r.tableId, JSON.stringify(r.data), r.createdAt,
        ]);
      }
    });
  });

  afterAll(async () => {
    await t?.close();
  });

  it.each(queries.map((q, i) => [i, q] as const))("query %i", async (_i, q) => {
    const p = buildRecordQuery(bp, q, { now });
    const mem = memoryQuery(rows, p);
    expect(await sql(p)).toEqual({ ids: mem.records.map((r) => r.id), total: mem.total });
  });

  it.each(aggregates.map((a, i) => [i, a] as const))("aggregate %i", async (_i, source) => {
    if (source.filters?.some((f) => f.value === "opt_cancelled_nonexistent")) {
      // unknown option ids are rejected by validation, so test the empty case on raw params
      const p: AggregateParams = { p_table_id: "tbl_bookings", p_filters: [{ field: "fld_status", op: "eq", kind: "text", value: "nope" }], p_agg: "sum", p_field: "fld_amount" };
      expect(await sqlAgg(p)).toBe(memoryAggregate(rows, p));
      return;
    }
    const p = buildAggregate(bp, source, { now });
    const mem = memoryAggregate(rows, p);
    const db = await sqlAgg(p);
    expect(db === null ? null : Math.round(db * 1e6) / 1e6).toBe(mem === null ? null : Math.round(mem * 1e6) / 1e6);
  });
});
