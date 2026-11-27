/** A table added to the setup starts empty; undoing a removal brings its records back. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyBlueprint } from "@/schema/blueprint";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let alice: string;
let biz: string;
const v = (n: number) => JSON.stringify({ ...emptyBlueprint({ name: "Build Lab", type: "other", timezone: "UTC" }), version: n });
const addClients = JSON.stringify({ ops: [{ op: "addTable", table: { id: "tbl_clients", label: "Clients", fields: [] } }] });

describe.skipIf(!testDbUrl)("fresh tables", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    alice = await t.newUser();
    biz = await t.createBusiness(alice, "Build Lab");
    // Left over from an earlier setup whose Clients table was removed.
    await t.db.query("insert into public.records (business_id, table_id, data) values ($1, 'tbl_clients', '{\"fld_name\":\"Old client\"}')", [biz]);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("undoing a removal keeps the records", async () => {
    await t.asCommit(alice, (c) => c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'undo', 'Undo', $3::jsonb, '{}')", [biz, v(2), addClients]));
    expect((await t.db.query("select count(*)::int as n from public.records where business_id = $1 and table_id = 'tbl_clients'", [biz])).rows[0].n).toBe(1);
  });

  it("adding a table again starts it empty", async () => {
    await t.asCommit(alice, (c) => c.query("select public.commit_blueprint_version($1, 2, $2::jsonb, 'ai', 'Add Clients', $3::jsonb, '{}')", [biz, v(3), addClients]));
    expect((await t.db.query("select count(*)::int as n from public.records where business_id = $1 and table_id = 'tbl_clients'", [biz])).rows[0].n).toBe(0);
  });
});
