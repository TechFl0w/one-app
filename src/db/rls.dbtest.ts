/**
 * Row-level security tests. Run with `npm run test:db` (spins up a throwaway Postgres).
 * Applies a Supabase stub + every migration to a fresh database, then acts as different users.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyBlueprint } from "@/schema/blueprint";

const url = process.env.TEST_DATABASE_URL;
const root = join(__dirname, "../..");

let admin: Client;
let db: Client;
const dbName = `oneapp_test_${Date.now()}`;

const alice = randomUUID(); // owner of Alice's Salon
const bob = randomUUID(); // owner of Bob's Garage
const carol = randomUUID(); // staff at Alice's Salon
let salon: string;
let garage: string;

/** Run `fn` inside a transaction as an authenticated user (like a Supabase request). */
async function as<T>(uid: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${uid ? "authenticated" : "anon"}`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

/** Same, but commits. */
async function asCommit<T>(uid: string, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    const r = await fn(db);
    await db.query("commit");
    return r;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

const bp = (name: string) => JSON.stringify(emptyBlueprint({ name, type: "other", timezone: "UTC" }));

async function createBusiness(uid: string, name: string): Promise<string> {
  return asCommit(uid, async (c) => {
    const r = await c.query("select public.create_business($1, 'other', 'UTC', $2::jsonb) as id", [name, bp(name)]);
    return r.rows[0].id as string;
  });
}

describe.skipIf(!url)("RLS", () => {
  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(url!);
    u.pathname = `/${dbName}`;
    db = new Client({ connectionString: u.toString() });
    await db.connect();

    await db.query(readFileSync(join(root, "supabase/tests/supabase-stub.sql"), "utf8"));
    const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    for (const f of migrations) await db.query(readFileSync(join(root, "supabase/migrations", f), "utf8"));

    for (const id of [alice, bob, carol]) await db.query("insert into auth.users (id) values ($1)", [id]);
    salon = await createBusiness(alice, "Alice's Salon");
    garage = await createBusiness(bob, "Bob's Garage");
    await db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [salon, carol]);
  });

  afterAll(async () => {
    await db?.end();
    await admin?.query(`drop database if exists ${dbName}`);
    await admin?.end();
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
