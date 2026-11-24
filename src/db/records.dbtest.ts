/** Records store: RLS, query_records filters/sorts, patch_record. Run with `npm run test:db`. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { buildRecordQuery } from "@/engine/records";
import { salonBlueprint } from "@/engine/__tests__/fixtures";
import type { RecordQuery } from "@/schema/records";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let stranger: string;
let salon: string;
let other: string;
const ids: Record<string, string> = {};

const bp = { ...salonBlueprint(), version: 1 };

async function insert(c: Client, business: string, table: string, data: object): Promise<string> {
  const r = await c.query("insert into public.records (business_id, table_id, data) values ($1, $2, $3) returning id", [
    business,
    table,
    JSON.stringify(data),
  ]);
  return r.rows[0].id;
}

/** Calls query_records exactly as the server does, with params built from the blueprint. */
async function query(c: Client, q: RecordQuery, business = salon) {
  const p = buildRecordQuery(bp, q);
  const r = await c.query(
    "select id, data, total from public.query_records($1, $2, $3::jsonb, $4::jsonb, $5, $6)",
    [business, p.p_table_id, JSON.stringify(p.p_filters), JSON.stringify(p.p_sort), p.p_limit, p.p_offset],
  );
  return r.rows as { id: string; data: Record<string, unknown>; total: string }[];
}

const names = (rows: { data: Record<string, unknown> }[]) => rows.map((r) => r.data.fld_note ?? r.data.fld_name);

describe.skipIf(!testDbUrl)("records", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff, stranger] = [await t.newUser(), await t.newUser(), await t.newUser()];
    salon = await t.createBusiness(owner, "Salon", bp);
    other = await t.createBusiness(stranger, "Other");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [salon, staff]);

    await t.asCommit(owner, async (c) => {
      ids.ann = await insert(c, salon, "tbl_team", { fld_name: "Ann" });
      ids.bo = await insert(c, salon, "tbl_team", { fld_name: "Bo" });
      // fld_note isn't in the blueprint; it just labels rows for assertions.
      ids.b1 = await insert(c, salon, "tbl_bookings", { fld_note: "b1", fld_start: "2026-12-01T17:00:00.000Z", fld_amount: 45, fld_status: "opt_booked", fld_practitioner: ids.ann });
      ids.b2 = await insert(c, salon, "tbl_bookings", { fld_note: "b2", fld_start: "2026-12-02T17:00:00.000Z", fld_amount: 120, fld_status: "opt_done", fld_practitioner: ids.bo });
      ids.b3 = await insert(c, salon, "tbl_bookings", { fld_note: "b3", fld_start: "2026-11-30T17:00:00.000Z", fld_amount: 9.5, fld_status: "opt_booked" });
      ids.c1 = await insert(c, salon, "tbl_clients", { fld_name: "100% Real_Name" });
      ids.c2 = await insert(c, salon, "tbl_clients", { fld_name: "Plain Jane" });
    });
    await t.asCommit(stranger, (c) => insert(c, other, "tbl_bookings", { fld_note: "theirs", fld_amount: 999 }));
  });

  afterAll(async () => {
    await t?.close();
  });

  it("filters numbers numerically, not as text", async () => {
    await t.as(owner, async (c) => {
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_amount", op: "gte", value: 45 }], sort: [{ field: "fld_amount", dir: "asc" }] }))).toEqual(["b1", "b2"]);
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_amount", op: "lt", value: 10 }] }))).toEqual(["b3"]);
    });
  });

  it("sorts by datetime and filters by status, link and emptiness", async () => {
    await t.as(owner, async (c) => {
      expect(names(await query(c, { table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }] }))).toEqual(["b3", "b1", "b2"]);
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_status", op: "eq", value: "opt_booked" }], sort: [{ field: "fld_start", dir: "desc" }] }))).toEqual(["b1", "b3"]);
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_practitioner", op: "eq", value: ids.bo }] }))).toEqual(["b2"]);
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_practitioner", op: "empty" }] }))).toEqual(["b3"]);
      expect(names(await query(c, { table: "tbl_bookings", filters: [{ field: "fld_status", op: "neq", value: "opt_booked" }] }))).toEqual(["b2"]);
    });
  });

  it("contains treats %, _ and quotes literally", async () => {
    await t.as(owner, async (c) => {
      expect(names(await query(c, { table: "tbl_clients", filters: [{ field: "fld_name", op: "contains", value: "0% real_" }] }))).toEqual(["100% Real_Name"]);
      expect(names(await query(c, { table: "tbl_clients", filters: [{ field: "fld_name", op: "contains", value: "%" }] }))).toEqual(["100% Real_Name"]);
      expect(await query(c, { table: "tbl_clients", filters: [{ field: "fld_name", op: "contains", value: "'; drop table records; --" }] })).toEqual([]);
    });
  });

  it("paginates and reports the total", async () => {
    await t.as(owner, async (c) => {
      const page = await query(c, { table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }], limit: 2, offset: 1 });
      expect(names(page)).toEqual(["b1", "b2"]);
      expect(Number(page[0].total)).toBe(3);
    });
  });

  it("rejects malformed filters at the database too", async () => {
    await t.as(owner, async (c) => {
      await expect(
        c.query("select * from public.query_records($1, 'tbl_bookings', $2::jsonb)", [salon, JSON.stringify([{ field: "fld_x') or true --", op: "eq", kind: "text", value: "x" }])]),
      ).rejects.toThrow(/invalid filter field/);
    });
    await t.as(owner, async (c) => {
      await expect(
        c.query("select * from public.query_records($1, 'tbl_bookings', $2::jsonb)", [salon, JSON.stringify([{ field: "fld_amount", op: "gt", kind: "array", value: "x" }])]),
      ).rejects.toThrow(/not allowed/);
    });
  });

  it("only shows a business's own records", async () => {
    await t.as(stranger, async (c) => {
      expect(await query(c, { table: "tbl_bookings" })).toEqual([]);
      expect(names(await query(c, { table: "tbl_bookings" }, other))).toEqual(["theirs"]);
      expect((await c.query("select * from public.records where business_id = $1", [salon])).rows).toEqual([]);
    });
    await t.as(owner, async (c) => {
      expect(await query(c, { table: "tbl_bookings" }, other)).toEqual([]);
    });
  });

  it("strangers cannot write into another business", async () => {
    await expect(t.as(stranger, (c) => insert(c, salon, "tbl_bookings", {}))).rejects.toThrow(/row-level security/);
    await t.as(stranger, async (c) => {
      const r = await c.query("select * from public.patch_record($1, 'tbl_bookings', $2, '{\"fld_amount\": 0}', '{}')", [salon, ids.b1]);
      expect(r.rows).toEqual([]);
      expect((await c.query("delete from public.records where id = $1", [ids.b1])).rowCount).toBe(0);
    });
  });

  it("staff can create and update but not delete", async () => {
    await t.as(staff, async (c) => {
      const id = await insert(c, salon, "tbl_clients", { fld_name: "Walk-in" });
      expect(id).toBeTruthy();
      expect((await c.query("delete from public.records where id = $1", [ids.c2])).rowCount).toBe(0);
    });
  });

  it("patch_record merges, clears and stamps updated_by", async () => {
    await t.as(staff, async (c) => {
      const r = await c.query("select * from public.patch_record($1, 'tbl_bookings', $2, $3::jsonb, $4)", [
        salon,
        ids.b1,
        JSON.stringify({ fld_amount: 50 }),
        ["fld_practitioner"],
      ]);
      expect(r.rows[0].data).toEqual({ fld_note: "b1", fld_start: "2026-12-01T17:00:00.000Z", fld_amount: 50, fld_status: "opt_booked" });
      const meta = await c.query("select updated_by, updated_at > created_at as touched from public.records where id = $1", [ids.b1]);
      expect(meta.rows[0]).toEqual({ updated_by: staff, touched: true });
    });
  });

  it("records cannot be moved to another business", async () => {
    await t.as(owner, async (c) => {
      await c.query("update public.records set business_id = $1 where id = $2", [other, ids.c1]);
      const r = await c.query("select business_id from public.records where id = $1", [ids.c1]);
      expect(r.rows).toEqual([{ business_id: salon }]);
    });
  });
});
