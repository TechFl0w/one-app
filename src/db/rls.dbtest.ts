/**
 * Row-level security tests. Run with `npm run test:db` (spins up a throwaway Postgres).
 * Applies a Supabase stub + every migration to a fresh database, then acts as different users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyBlueprint } from "@/schema/blueprint";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let alice: string; // owner of Alice's Salon
let bob: string; // owner of Bob's Garage
let carol: string; // staff at Alice's Salon
let salon: string;
let garage: string;

const as: TestDb["as"] = (uid, fn) => t.as(uid, fn);
const bp = (name: string) => JSON.stringify(emptyBlueprint({ name, type: "other", timezone: "UTC" }));

describe.skipIf(!testDbUrl)("RLS", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [alice, bob, carol] = [await t.newUser(), await t.newUser(), await t.newUser()];
    salon = await t.createBusiness(alice, "Alice's Salon");
    garage = await t.createBusiness(bob, "Bob's Garage");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [salon, carol]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("create_business makes the caller owner and stores blueprint v1", async () => {
    await as(alice, async (c) => {
      const m = await c.query("select role from public.memberships where business_id = $1 and user_id = $2", [salon, alice]);
      expect(m.rows).toEqual([{ role: "owner" }]);
      const b = await c.query("select version from public.current_blueprints where business_id = $1", [salon]);
      expect(b.rows).toEqual([{ version: 1 }]);
    });
  });

  it("users only see businesses they belong to", async () => {
    const names = async (uid: string) =>
      as(uid, async (c) => (await c.query("select name from public.businesses order by name")).rows.map((r) => r.name));
    expect(await names(alice)).toEqual(["Alice's Salon"]);
    expect(await names(bob)).toEqual(["Bob's Garage"]);
    expect(await names(carol)).toEqual(["Alice's Salon"]);
    await as(alice, async (c) => {
      expect((await c.query("select id from public.businesses where id = $1", [garage])).rows).toEqual([]);
    });
  });

  it("anonymous users see nothing and cannot create businesses", async () => {
    await as(null, async (c) => {
      expect((await c.query("select * from public.businesses")).rows).toEqual([]);
    });
    await expect(as(null, (c) => c.query("select public.create_business('x', 'other', 'UTC', $1::jsonb)", [bp("x")]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("users cannot read another business's blueprints or history", async () => {
    await as(bob, async (c) => {
      expect((await c.query("select * from public.blueprints where business_id = $1", [salon])).rows).toEqual([]);
      expect((await c.query("select * from public.blueprint_history where business_id = $1", [salon])).rows).toEqual([]);
      expect((await c.query("select * from public.memberships where business_id = $1", [salon])).rows).toEqual([]);
    });
  });

  it("users cannot write into another business", async () => {
    await expect(
      as(bob, (c) =>
        c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'ui', null, '{}', '{}')", [
          salon,
          JSON.stringify({ ...JSON.parse(bp("hacked")), version: 2 }),
        ]),
      ),
    ).rejects.toThrow(/business not found|row-level security/);

    await expect(
      as(bob, (c) => c.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'owner')", [salon, bob])),
    ).rejects.toThrow(/row-level security/);

    await as(bob, async (c) => {
      const r = await c.query("update public.businesses set name = 'pwned' where id = $1", [salon]);
      expect(r.rowCount).toBe(0);
    });
  });

  it("staff can read but not change the blueprint", async () => {
    await as(carol, async (c) => {
      expect((await c.query("select version from public.blueprints where business_id = $1", [salon])).rows).toHaveLength(1);
    });
    await expect(
      as(carol, (c) =>
        c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'ui', null, '{}', '{}')", [
          salon,
          JSON.stringify({ ...JSON.parse(bp("x")), version: 2 }),
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("owners commit new versions; stale versions conflict", async () => {
    await as(alice, async (c) => {
      const next = JSON.stringify({ ...JSON.parse(bp("Alice's Salon")), version: 2 });
      await c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'ui', 'test', '{}', '{}')", [salon, next]);
      const v = await c.query("select version from public.current_blueprints where business_id = $1", [salon]);
      expect(v.rows).toEqual([{ version: 2 }]);
      const h = await c.query("select from_version, to_version, source from public.blueprint_history where business_id = $1 order by to_version", [salon]);
      expect(h.rows).toEqual([
        { from_version: 0, to_version: 1, source: "system" },
        { from_version: 1, to_version: 2, source: "ui" },
      ]);
      await expect(
        c.query("select public.commit_blueprint_version($1, 1, $2::jsonb, 'ui', null, '{}', '{}')", [salon, next]),
      ).rejects.toThrow(/blueprint changed/);
    });
  });

  it("blueprints and history are append-only", async () => {
    await as(alice, async (c) => {
      expect((await c.query("update public.blueprints set json = '{}' where business_id = $1", [salon])).rowCount).toBe(0);
      expect((await c.query("delete from public.blueprint_history where business_id = $1", [salon])).rowCount).toBe(0);
    });
  });
});
