/** Audit log: written by triggers for every path, append-only, owners/admins only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let stranger: string;
let biz: string;

/** Simulates the x-one-source request header PostgREST exposes. */
const asAssistant = (c: Client) => c.query(`select set_config('request.headers', '{"x-one-source":"ai"}', true)`);
const log = async () =>
  (await t.db.query("select action, source, actor_id, table_id, summary, details from public.audit_log where business_id = $1 order by id", [biz])).rows;

describe.skipIf(!testDbUrl)("audit log", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff, stranger] = [await t.newUser(), await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    await t.createBusiness(stranger, "Other");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("logs business creation as a setup change", async () => {
    expect(await log()).toEqual([expect.objectContaining({ action: "setup.changed", source: "system", actor_id: owner, summary: "Created business" })]);
  });

  it("logs record create / update (changed fields only) / delete with actor and source", async () => {
    const id = randomUUID();
    await t.asCommit(staff, (c) => c.query("insert into public.records (id, business_id, table_id, data) values ($1, $2, 'tbl_clients', '{\"fld_name\":\"Ava\",\"fld_vip\":false}')", [id, biz]));
    await t.asCommit(owner, async (c) => {
      await asAssistant(c);
      await c.query("update public.records set data = data || '{\"fld_vip\":true}' where id = $1", [id]);
      await c.query("update public.records set data = data where id = $1", [id]); // no-op: not logged
    });
    await t.asCommit(owner, (c) => c.query("delete from public.records where id = $1", [id]));

    const rows = (await log()).slice(1);
    expect(rows.map((r) => [r.action, r.source, r.actor_id])).toEqual([
      ["record.created", "ui", staff],
      ["record.updated", "ai", owner],
      ["record.deleted", "ui", owner],
    ]);
    expect(rows[1].details).toEqual({ changes: { fld_vip: { before: false, after: true } } });
    expect(rows[2].details.before).toEqual({ fld_name: "Ava", fld_vip: true });
  });

  it("logs setup changes, undo and confirmations", async () => {
    await t.asCommit(owner, async (c) => {
      const bp = (await c.query("select json from public.current_blueprints where business_id = $1", [biz])).rows[0].json;
      await c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'ai', 'Rename page', '{}', '{}')", [biz, JSON.stringify({ ...bp, version: 2 })]);
      await c.query("select public.commit_blueprint_version($1, 2, $2::jsonb, 'undo', 'Undo: Rename page', '{}', '{}')", [biz, JSON.stringify({ ...bp, version: 3 })]);
      const action = randomUUID();
      await c.query("insert into public.agent_pending_actions (id, business_id, tool, input, items) values ($1, $2, 'delete_record', '{}', '[\"Delete Ava\"]')", [action, biz]);
      await c.query("update public.agent_pending_actions set status = 'confirmed' where id = $1", [action]);
    });
    const rows = (await log()).slice(-3);
    expect(rows.map((r) => [r.action, r.source, r.summary])).toEqual([
      ["setup.changed", "ai", "Rename page"],
      ["setup.undone", "undo", "Undo: Rename page"],
      ["confirmation.confirmed", "ai", "Delete Ava"],
    ]);
  });

  it("is readable by owners only (not staff or strangers) and can't be written or edited", async () => {
    await t.as(owner, async (c) => expect((await c.query("select count(*)::int as n from public.audit_log")).rows[0].n).toBeGreaterThan(3));
    await t.as(staff, async (c) => expect((await c.query("select * from public.audit_log")).rows).toEqual([]));
    await t.as(stranger, async (c) => expect((await c.query("select * from public.audit_log where business_id = $1", [biz])).rows).toEqual([]));
    await expect(t.as(owner, (c) => c.query("insert into public.audit_log (business_id, action) values ($1, 'fake')", [biz]))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("delete from public.audit_log where business_id = $1", [biz]))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("update public.audit_log set summary = 'x' where business_id = $1", [biz]))).rejects.toThrow(/permission denied/);
  });
});
