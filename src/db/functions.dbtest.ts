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
    await t.db.query("insert into public.business_secrets (business_id, name, host, prefix, value) values ($1, 'SHIPPO', 'api.goshippo.com', 'ShippoToken ', 'real-key')", [biz]);
    await t.db.query("insert into public.function_runs (business_id, function_id, trigger, token_hash, expires_at) values ($1, 'fn_sync', 'test', $2, now() + interval '2 minutes')", [biz, hash]);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("keeps key values away from every signed-in user", async () => {
    for (const uid of [owner, staff]) {
      await expect(t.as(uid, (c) => c.query("select value from public.business_secrets"))).rejects.toThrow(/permission denied/);
    }
    await expect(t.as(owner, (c) => c.query("insert into public.business_secrets (business_id, name, host, value) values ($1, 'X', 'a.com', 'v')", [biz]))).rejects.toThrow(/permission denied/);
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
    await expect(t.db.query("insert into public.business_secrets (business_id, name, host, value) values ($1, 'bad name', 'a.com', 'v')", [biz])).rejects.toThrow(/check constraint/);
    await expect(t.db.query("insert into public.business_secrets (business_id, name, host, value) values ($1, 'OK', 'https://a.com', 'v')", [biz])).rejects.toThrow(/check constraint/);
  });
});
