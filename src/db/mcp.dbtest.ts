/** MCP: tokens are server-written and private to their owner; approvals and the 'mcp' audit source. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let admin2: string;
let staff: string;
let biz: string;
const hash = (c: string) => c.repeat(64);

describe.skipIf(!testDbUrl)("mcp storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, admin2, staff] = [await t.newUser(), await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'staff')", [biz, admin2, staff]);
    await t.db.query("insert into public.api_tokens (business_id, user_id, name, token_hash, hint) values ($1, $2, 'Laptop', $3, 'one_ab…cd')", [biz, owner, hash("a")]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("stores only well-formed unique hashes", async () => {
    await expect(t.db.query("insert into public.api_tokens (business_id, user_id, name, token_hash, hint) values ($1, $2, 'x', $3, 'h')", [biz, owner, hash("a")])).rejects.toThrow(/duplicate key/);
    await expect(t.db.query("insert into public.api_tokens (business_id, user_id, name, token_hash, hint) values ($1, $2, 'x', 'one_plaintext', 'h')", [biz, owner])).rejects.toThrow(/check constraint/);
  });

  it("each owner sees only their own tokens and can't write them", async () => {
    await t.as(owner, async (c) => expect((await c.query("select name from public.api_tokens")).rows).toEqual([{ name: "Laptop" }]));
    for (const uid of [admin2, staff]) await t.as(uid, async (c) => expect((await c.query("select * from public.api_tokens")).rows).toEqual([]));
    await expect(t.as(owner, (c) => c.query("update public.api_tokens set revoked_at = null"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("insert into public.api_tokens (business_id, user_id, name, token_hash, hint) values ($1, $2, 'x', $3, 'h')", [biz, owner, hash("b")]))).rejects.toThrow(/permission denied/);
  });

  it("MCP approvals show for their owner, and confirming them is audited", async () => {
    await t.db.query("insert into public.agent_pending_actions (id, business_id, user_id, tool, input, items, origin) values (gen_random_uuid(), $1, $2, 'delete_record', '{}', '[\"Delete Ava\"]', 'mcp')", [biz, owner]);
    await t.asCommit(owner, async (c) => {
      expect((await c.query("select origin from public.agent_pending_actions where status = 'pending'")).rows).toEqual([{ origin: "mcp" }]);
      expect((await c.query("update public.agent_pending_actions set status = 'cancelled' where origin = 'mcp'")).rowCount).toBe(1);
    });
    await t.as(admin2, async (c) => expect((await c.query("select * from public.agent_pending_actions")).rows).toEqual([]));
    const a = await t.db.query("select action, summary from public.audit_log where business_id = $1 and action like 'confirmation.%'", [biz]);
    expect(a.rows).toEqual([{ action: "confirmation.cancelled", summary: "Delete Ava" }]);
  });

  it("writes tagged x-one-source: mcp are audited as mcp and still trigger automations", async () => {
    await t.db.query("begin");
    await t.db.query(`select set_config('request.headers', '{"x-one-source":"mcp"}', true)`);
    await t.db.query("insert into public.records (business_id, table_id, data) values ($1, 'tbl_clients', '{}')", [biz]);
    await t.db.query("commit");
    const a = await t.db.query("select source from public.audit_log where business_id = $1 and action = 'record.created'", [biz]);
    expect(a.rows).toEqual([{ source: "mcp" }]);
    const e = await t.db.query("select source from public.record_events where business_id = $1", [biz]);
    expect(e.rows).toEqual([{ source: "mcp" }]);
  });
});
