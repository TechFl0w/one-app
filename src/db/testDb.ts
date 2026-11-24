/** Test helper: a fresh database with the Supabase stub + all migrations, and "act as user" helpers. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { emptyBlueprint } from "@/schema/blueprint";

const root = join(__dirname, "../..");
export const testDbUrl = process.env.TEST_DATABASE_URL;

export interface TestDb {
  db: Client;
  /** Run inside a transaction as a user (null = anon), then roll back. */
  as<T>(uid: string | null, fn: (c: Client) => Promise<T>): Promise<T>;
  /** Same, but commit. */
  asCommit<T>(uid: string, fn: (c: Client) => Promise<T>): Promise<T>;
  newUser(): Promise<string>;
  createBusiness(uid: string, name: string, blueprint?: unknown): Promise<string>;
  close(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const admin = new Client({ connectionString: testDbUrl });
  await admin.connect();
  const dbName = `oneapp_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`create database ${dbName}`);
  const u = new URL(testDbUrl!);
  u.pathname = `/${dbName}`;
  const db = new Client({ connectionString: u.toString() });
  await db.connect();

  await db.query(readFileSync(join(root, "supabase/tests/supabase-stub.sql"), "utf8"));
  const dir = join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(dir, f), "utf8"));
  }

  const tx = async <T>(uid: string | null, fn: (c: Client) => Promise<T>, commit: boolean) => {
    await db.query("begin");
    try {
      await db.query(`set local role ${uid ? "authenticated" : "anon"}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
      const r = await fn(db);
      await db.query(commit ? "commit" : "rollback");
      return r;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  };

  const t: TestDb = {
    db,
    as: (uid, fn) => tx(uid, fn, false),
    asCommit: (uid, fn) => tx(uid, fn, true),
    async newUser() {
      const id = randomUUID();
      await db.query("insert into auth.users (id) values ($1)", [id]);
      return id;
    },
    async createBusiness(uid, name, blueprint) {
      const bp = blueprint ?? emptyBlueprint({ name, type: "other", timezone: "UTC" });
      return t.asCommit(uid, async (c) => {
        const r = await c.query("select public.create_business($1, 'other', 'UTC', $2::jsonb) as id", [name, JSON.stringify(bp)]);
        return r.rows[0].id as string;
      });
    },
    async close() {
      await db.end();
      await admin.query(`drop database if exists ${dbName}`);
      await admin.end();
    },
  };
  return t;
}
