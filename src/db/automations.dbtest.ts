/** Automation tables: event outbox trigger, job claiming, RLS. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let biz: string;

const asSource = (c: Client, source: string) => c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ "x-one-source": source })]);
const events = async () => (await t.db.query("select kind, before, after, source from public.record_events where business_id = $1 order by id", [biz])).rows;

/** Runs as the worker (service role bypasses RLS). */
async function asService<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  await t.db.query("begin");
  try {
    await t.db.query("set local role service_role");
    const r = await fn(t.db);
    await t.db.query("commit");
    return r;
  } catch (e) {
    await t.db.query("rollback");
    throw e;
  }
}

describe.skipIf(!testDbUrl)("automations storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff] = [await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("records an event for every real change, except changes made by automations", async () => {
    const id = randomUUID();
    await t.asCommit(staff, (c) => c.query("insert into public.records (id, business_id, table_id, data) values ($1, $2, 'tbl_x', '{\"fld_a\":1}')", [id, biz]));
    await t.asCommit(owner, async (c) => {
      await asSource(c, "ai");
      await c.query("update public.records set data = '{\"fld_a\":2}' where id = $1", [id]);
      await c.query("update public.records set data = data where id = $1", [id]); // no-op
    });
    await t.asCommit(owner, async (c) => {
      await asSource(c, "automation");
      await c.query("update public.records set data = '{\"fld_a\":3}' where id = $1", [id]); // by an automation: no event
    });
    await t.asCommit(owner, (c) => c.query("delete from public.records where id = $1", [id]));
    expect(await events()).toEqual([
      { kind: "created", before: null, after: { fld_a: 1 }, source: "ui" },
      { kind: "updated", before: { fld_a: 1 }, after: { fld_a: 2 }, source: "ai" },
      { kind: "deleted", before: { fld_a: 3 }, after: null, source: "ui" },
    ]);
  });

  it("claims due jobs once, skips future ones, and reclaims stuck ones", async () => {
    await asService(async (c) => {
      for (const [key, runAt] of [["a", "2026-11-24T10:00:00Z"], ["b", "2026-11-24T10:05:00Z"], ["c", "2026-11-25T10:00:00Z"]]) {
        await c.query("insert into public.automation_jobs (business_id, automation_id, table_id, record_id, key, run_at) values ($1, 'aut_x', 'tbl_x', $2, $3, $4)", [biz, randomUUID(), key, runAt]);
      }
    });
    await expect(
      asService((c) => c.query("insert into public.automation_jobs (business_id, automation_id, table_id, record_id, key, run_at) values ($1, 'aut_x', 'tbl_x', $2, 'a', now())", [biz, randomUUID()])),
    ).rejects.toThrow(/duplicate key/);
    const claim = (now: string, limit = 10) =>
      asService(async (c) => (await c.query("select key from public.claim_automation_jobs($1, $2)", [now, limit])).rows.map((r) => r.key).sort());
    expect(await claim("2026-11-24T10:06:00Z")).toEqual(["a", "b"]);
    expect(await claim("2026-11-24T10:07:00Z")).toEqual([]); // already running
    expect(await claim("2026-11-24T10:20:00Z")).toEqual(["a", "b"]); // stuck >10 min: reclaimed
    expect(await claim("2026-11-25T10:00:00Z", 1)).toEqual(["a"]);
  });

  it("owners read runs and notifications; staff and users can't touch the queue", async () => {
    await asService(async (c) => {
      await c.query("insert into public.automation_runs (business_id, automation_id, status) values ($1, 'aut_x', 'done')", [biz]);
      await c.query("insert into public.notifications (business_id, key, message) values ($1, 'k1', 'Low stock')", [biz]);
    });
    await t.as(owner, async (c) => {
      expect((await c.query("select status from public.automation_runs")).rows).toEqual([{ status: "done" }]);
      expect((await c.query("update public.notifications set read_at = now() where key = 'k1'")).rowCount).toBe(1);
    });
    await t.as(owner, async (c) => {
      await expect(c.query("update public.notifications set message = 'x'")).rejects.toThrow(/permission denied/);
    });
    await t.as(staff, async (c) => {
      expect((await c.query("select * from public.automation_runs")).rows).toEqual([]);
      expect((await c.query("select * from public.notifications")).rows).toEqual([]);
    });
    for (const sql of ["select * from public.automation_jobs", "select * from public.record_events", "select * from public.claim_automation_jobs(now(), 1)"]) {
      await expect(t.as(owner, (c) => c.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
