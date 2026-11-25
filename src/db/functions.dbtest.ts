/** Function runs and saved API keys: keys are never readable by signed-in users, only their names. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let biz: string;
const hash = "a".repeat(64);

describe.skipIf(!testDbUrl)("function storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff] = [await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Shop");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
    await t.db.query("select public.set_business_secret($1, 'SHIPPO', 'api.goshippo.com', 'Authorization', 'ShippoToken ', 'real-key')", [biz]);
    await t.db.query("insert into public.function_runs (business_id, function_id, trigger, token_hash, expires_at) values ($1, 'fn_sync', 'test', $2, now() + interval '2 minutes')", [biz, hash]);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("keeps key values in Vault, away from every signed-in user", async () => {
    for (const uid of [owner, staff]) {
      await expect(t.as(uid, (c) => c.query("select vault_id from public.business_secrets"))).rejects.toThrow(/permission denied/);
      await expect(t.as(uid, (c) => c.query("select * from public.business_secret_values($1, '{api.goshippo.com}')", [biz]))).rejects.toThrow(/permission denied/);
      await expect(t.as(uid, (c) => c.query("select public.set_business_secret($1, 'X', 'a.com', 'Authorization', '', 'v')", [biz]))).rejects.toThrow(/permission denied/);
    }
    // The server reads values only for the hosts a function may reach.
    expect((await t.db.query("select name, prefix, value from public.business_secret_values($1, '{api.goshippo.com}')", [biz])).rows).toEqual([{ name: "SHIPPO", prefix: "ShippoToken ", value: "real-key" }]);
    expect((await t.db.query("select * from public.business_secret_values($1, '{other.com}')", [biz])).rows).toEqual([]);
    // Updating replaces the value; removing deletes it from Vault too.
    await t.db.query("select public.set_business_secret($1, 'SHIPPO', 'api.goshippo.com', 'Authorization', 'ShippoToken ', 'new-key')", [biz]);
    expect((await t.db.query("select value from public.business_secret_values($1, '{api.goshippo.com}')", [biz])).rows).toEqual([{ value: "new-key" }]);
    expect((await t.db.query("select count(*)::int n from vault.secrets")).rows[0].n).toBe(1);
    await t.as(owner, async (c) => {
      expect((await c.query("select name, host, header from public.business_secret_names($1)", [biz])).rows).toEqual([{ name: "SHIPPO", host: "api.goshippo.com", header: "Authorization" }]);
    });
    await t.as(staff, async (c) => expect((await c.query("select * from public.business_secret_names($1)", [biz])).rows).toEqual([]));
  });

  it("owners read runs but never the token hash", async () => {
    await t.as(owner, async (c) => expect((await c.query("select function_id, status from public.function_runs")).rows).toEqual([{ function_id: "fn_sync", status: "running" }]));
    await expect(t.as(owner, (c) => c.query("select token_hash from public.function_runs"))).rejects.toThrow(/permission denied/);
    await t.as(staff, async (c) => expect((await c.query("select id from public.function_runs")).rows).toEqual([]));
  });

  it("validates key names and hosts", async () => {
    await expect(t.db.query("select public.set_business_secret($1, 'bad name', 'a.com', 'Authorization', '', 'v')", [biz])).rejects.toThrow(/check constraint/);
    await expect(t.db.query("select public.set_business_secret($1, 'OK', 'https://a.com', 'Authorization', '', 'v')", [biz])).rejects.toThrow(/check constraint/);
    await t.db.query("delete from public.business_secrets where business_id = $1", [biz]);
    expect((await t.db.query("select count(*)::int n from vault.secrets")).rows[0].n).toBe(0);
  });
});

describe.skipIf(!testDbUrl)("generated-code writes and automations", () => {
  it("record their chain depth so automations run, and automation writes still don't", async () => {
    const t2 = await setupTestDb();
    try {
      const u = await t2.newUser();
      const b = await t2.createBusiness(u, "Shop");
      const write = async (headers: Record<string, string>) => {
        await t2.db.query("begin");
        await t2.db.query("select set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
        await t2.db.query("insert into public.records (business_id, table_id, data) values ($1, 'tbl_clients', '{}')", [b]);
        await t2.db.query("commit");
      };
      await write({ "x-one-source": "function", "x-one-depth": "2" });
      await write({ "x-one-source": "automation" });
      await write({ "x-one-source": "function", "x-one-depth": "bogus" });
      await write({ "x-one-depth": "5" }); // a person: depth is ignored
      const ev = await t2.db.query("select source, depth from public.record_events where business_id = $1 order by id", [b]);
      expect(ev.rows).toEqual([{ source: "function", depth: 2 }, { source: "function", depth: 0 }, { source: "ui", depth: 0 }]);
      const audit = await t2.db.query("select source from public.audit_log where business_id = $1 and action = 'record.created' order by id", [b]);
      expect(audit.rows.map((r) => r.source)).toEqual(["function", "system", "function", "ui"]);
    } finally {
      await t2.close();
    }
  });
});

describe.skipIf(!testDbUrl)("imports", () => {
  it("are audited as imports and don't trigger automations", async () => {
    const t3 = await setupTestDb();
    try {
      const u = await t3.newUser();
      const b = await t3.createBusiness(u, "Shop");
      await t3.db.query("begin");
      await t3.db.query(`select set_config('request.headers', '{"x-one-source":"import"}', true)`);
      await t3.db.query("insert into public.records (business_id, table_id, data) values ($1, 'tbl_clients', '{}'), ($1, 'tbl_clients', '{}')", [b]);
      await t3.db.query("commit");
      expect((await t3.db.query("select count(*)::int n from public.record_events where business_id = $1", [b])).rows[0].n).toBe(0);
      expect((await t3.db.query("select source from public.audit_log where business_id = $1 and action = 'record.created'", [b])).rows).toEqual([{ source: "import" }, { source: "import" }]);
    } finally {
      await t3.close();
    }
  });
});
