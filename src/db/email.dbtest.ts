/** Email tables: settings per business, unique inbound slugs, server-only writes, owners read. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let other: string;
let biz: string;
let otherBiz: string;

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

describe.skipIf(!testDbUrl)("email storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff, other] = [await t.newUser(), await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Glass Co");
    otherBiz = await t.createBusiness(other, "Other");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("owners set up and change their email settings; staff can't", async () => {
    await t.asCommit(owner, (c) => c.query("insert into public.business_email (business_id, slug, from_name) values ($1, 'glass-co', 'Glass Co')", [biz]));
    await t.as(owner, async (c) => {
      expect((await c.query("update public.business_email set reply_mode = 'owner', owner_email = 'me@gmail.com' where business_id = $1", [biz])).rowCount).toBe(1);
    });
    await t.as(staff, async (c) => expect((await c.query("select * from public.business_email")).rows).toEqual([]));
    await expect(t.as(staff, (c) => c.query("insert into public.business_email (business_id, slug, from_name) values ($1, 'staff-slug', 'x')", [biz]))).rejects.toThrow(/row-level security|duplicate key/);
  });

  it("inbound slugs are unique across businesses and well-formed", async () => {
    await expect(t.as(other, (c) => c.query("insert into public.business_email (business_id, slug, from_name) values ($1, 'glass-co', 'Copycat')", [otherBiz]))).rejects.toThrow(/duplicate key/);
    await expect(t.as(other, (c) => c.query("insert into public.business_email (business_id, slug, from_name) values ($1, 'Bad Slug!', 'x')", [otherBiz]))).rejects.toThrow(/check constraint/);
    await expect(t.as(owner, (c) => c.query("update public.business_email set owner_email = 'nope' where business_id = $1", [biz]))).rejects.toThrow(/check constraint/);
  });

  it("only the server writes outbound mail and the inbox; owners read and mark read", async () => {
    await asService(async (c) => {
      await c.query("insert into public.outbound_messages (business_id, key, channel, to_address, body_text) values ($1, 'k1', 'email', 'a@b.co', 'hi')", [biz]);
      await c.query("insert into public.inbox_messages (business_id, provider_id, from_address, received_at) values ($1, 'em_1', 'ava@x.com', now())", [biz]);
    });
    await expect(asService((c) => c.query("insert into public.outbound_messages (business_id, key, channel, to_address, body_text) values ($1, 'k1', 'email', 'a@b.co', 'again')", [biz]))).rejects.toThrow(/duplicate key/);
    await t.as(owner, async (c) => {
      expect((await c.query("select key from public.outbound_messages")).rows).toEqual([{ key: "k1" }]);
      expect((await c.query("update public.inbox_messages set read_at = now() where provider_id = 'em_1'")).rowCount).toBe(1);
    });
    await expect(t.as(owner, (c) => c.query("update public.inbox_messages set text_body = 'forged'"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("insert into public.outbound_messages (business_id, key, channel, to_address, body_text) values ($1, 'k2', 'email', 'a@b.co', 'x')", [biz]))).rejects.toThrow(/permission denied/);
    for (const uid of [staff, other]) {
      await t.as(uid, async (c) => {
        expect((await c.query("select * from public.inbox_messages")).rows).toEqual([]);
        expect((await c.query("select * from public.outbound_messages")).rows).toEqual([]);
      });
    }
  });
});
