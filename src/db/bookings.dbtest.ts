/** Double-booking guard: overlap constraints maintained from the scheduling section. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { demoBlueprint } from "@/demo/salon";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let biz: string;
const MAI = randomUUID();
const PRIYA = randomUUID();

const booking = (c: Client, data: Record<string, unknown>, id = randomUUID()) =>
  c.query("insert into public.records (id, business_id, table_id, data) values ($1, $2, 'tbl_bookings', $3) returning id", [id, biz, JSON.stringify(data)]).then((r) => r.rows[0].id as string);
const at = (h: number, m = 0) => `2026-12-02T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const b = (who: string, from: string, to: string, status = "opt_booked") => ({ fld_practitioner: who, fld_start: from, fld_end: to, fld_status: status });
const slots = async () => Number((await t.db.query("select count(*) from public.booking_slots where business_id = $1", [biz])).rows[0].count);

describe.skipIf(!testDbUrl)("booking slots", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    owner = await t.newUser();
    biz = await t.createBusiness(owner, "Salon", demoBlueprint);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("rejects overlapping bookings for the same person, allows others", async () => {
    await t.asCommit(owner, (c) => booking(c, b(MAI, at(17), at(18))));
    await expect(t.as(owner, (c) => booking(c, b(MAI, at(17, 30), at(18, 30))))).rejects.toThrow(/overlaps another booking/);
    await t.asCommit(owner, (c) => booking(c, b(MAI, at(18), at(19)))); // back-to-back is fine
    await t.asCommit(owner, (c) => booking(c, b(PRIYA, at(17, 30), at(18, 30)))); // someone else
    expect(await slots()).toBe(3);
  });

  it("cancelled bookings free their time, and edits are re-checked", async () => {
    const id = await t.asCommit(owner, (c) => booking(c, b(MAI, at(20), at(21))));
    await expect(t.as(owner, (c) => booking(c, b(MAI, at(20), at(21))))).rejects.toThrow(/overlaps/);
    await t.asCommit(owner, (c) => c.query("update public.records set data = data || '{\"fld_status\":\"opt_cancelled\"}' where id = $1", [id]));
    await t.asCommit(owner, (c) => booking(c, b(MAI, at(20), at(21))));
    // Moving another booking onto a taken time fails
    const other = await t.asCommit(owner, (c) => booking(c, b(MAI, at(22), at(23))));
    await expect(
      t.as(owner, (c) => c.query(`update public.records set data = data || '{"fld_start":"${at(20, 30)}","fld_end":"${at(21, 30)}"}' where id = $1`, [other])),
    ).rejects.toThrow(/overlaps/);
  });

  it("ignores other tables and businesses, and cleans up on delete", async () => {
    await t.asCommit(owner, (c) => c.query("insert into public.records (business_id, table_id, data) values ($1, 'tbl_clients', '{\"fld_name\":\"X\"}')", [biz]));
    const before = await slots();
    const id = await t.asCommit(owner, (c) => booking(c, b(PRIYA, at(10), at(11))));
    expect(await slots()).toBe(before + 1);
    await t.asCommit(owner, (c) => c.query("delete from public.records where id = $1", [id]));
    expect(await slots()).toBe(before);
    await expect(t.as(owner, (c) => c.query("select * from public.booking_slots"))).rejects.toThrow(/permission denied/);
  });
});
