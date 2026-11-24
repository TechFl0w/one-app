/** Owner chat storage: private per user, owners/admins only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let admin: string;
let staff: string;
let stranger: string;
let biz: string;

describe.skipIf(!testDbUrl)("owner chat RLS", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, admin, staff, stranger] = [await t.newUser(), await t.newUser(), await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    await t.createBusiness(stranger, "Other");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'staff')", [biz, admin, staff]);
    await t.asCommit(owner, (c) =>
      c.query("insert into public.owner_conversations (business_id, transcript) values ($1, '[{\"text\":\"secret plan\"}]')", [biz]),
    );
    await t.asCommit(owner, (c) =>
      c.query("insert into public.agent_pending_actions (id, business_id, tool, input, items) values ($1, $2, 'delete_record', '{}', '[]')", [randomUUID(), biz]),
    );
  });

  afterAll(async () => {
    await t?.close();
  });

  it("the owner sees their own conversation and pending actions", async () => {
    await t.as(owner, async (c) => {
      expect((await c.query("select * from public.owner_conversations")).rows).toHaveLength(1);
      expect((await c.query("select * from public.agent_pending_actions")).rows).toHaveLength(1);
    });
  });

  it("other members — even admins — can't read someone else's chat", async () => {
    for (const uid of [admin, staff, stranger]) {
      await t.as(uid, async (c) => {
        expect((await c.query("select * from public.owner_conversations")).rows).toEqual([]);
        expect((await c.query("select * from public.agent_pending_actions")).rows).toEqual([]);
      });
    }
  });

  it("admins get their own conversation; staff and strangers can't start one", async () => {
    await t.as(admin, (c) => c.query("insert into public.owner_conversations (business_id) values ($1)", [biz]));
    await expect(t.as(staff, (c) => c.query("insert into public.owner_conversations (business_id) values ($1)", [biz]))).rejects.toThrow(/row-level security/);
    await expect(t.as(stranger, (c) => c.query("insert into public.owner_conversations (business_id) values ($1)", [biz]))).rejects.toThrow(/row-level security/);
  });

  it("nobody can write a conversation or action in someone else's name", async () => {
    await expect(
      t.as(admin, (c) => c.query("insert into public.owner_conversations (business_id, user_id) values ($1, $2)", [biz, owner])),
    ).rejects.toThrow(/row-level security|duplicate key/);
    await expect(
      t.as(admin, (c) => c.query("insert into public.agent_pending_actions (id, business_id, user_id, tool, input, items) values ($1, $2, $3, 'x', '{}', '[]')", [randomUUID(), biz, owner])),
    ).rejects.toThrow(/row-level security/);
  });
});
