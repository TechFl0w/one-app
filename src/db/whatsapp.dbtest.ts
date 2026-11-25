/** WhatsApp tables: server writes; owners read and may only switch mode / clear unread. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let stranger: string;
let biz: string;
let other: string;

describe.skipIf(!testDbUrl)("whatsapp storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff, stranger] = [await t.newUser(), await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    other = await t.createBusiness(stranger, "Other");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
    await t.db.query("insert into public.whatsapp_lines (business_id, phone_e164, status) values ($1, '+16045550199', 'online')", [biz]);
    const c = await t.db.query("insert into public.conversations (business_id, customer_phone) values ($1, '+16045550101') returning id", [biz]);
    await t.db.query("insert into public.conversation_messages (conversation_id, business_id, direction, author, body, provider_sid) values ($1, $2, 'in', 'customer', 'Hi', 'SM1')", [c.rows[0].id, biz]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("each business number belongs to one business; numbers are E.164", async () => {
    await expect(t.db.query("insert into public.whatsapp_lines (business_id, phone_e164) values ($1, '+16045550199')", [other])).rejects.toThrow(/duplicate key/);
    await expect(t.db.query("insert into public.whatsapp_lines (business_id, phone_e164) values ($1, '604-555')", [other])).rejects.toThrow(/check constraint/);
    await expect(t.db.query("insert into public.conversation_messages (conversation_id, business_id, direction, author, body, provider_sid) select id, business_id, 'in', 'customer', 'again', 'SM1' from public.conversations limit 1")).rejects.toThrow(/duplicate key/);
  });

  it("owners read and can take over; nobody can forge messages", async () => {
    await t.as(owner, async (c) => {
      expect((await c.query("select body from public.conversation_messages")).rows).toEqual([{ body: "Hi" }]);
      expect((await c.query("update public.conversations set mode = 'owner', unread = 0")).rowCount).toBe(1);
    });
    await expect(t.as(owner, (c) => c.query("update public.conversations set customer_phone = '+19999999999'"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("insert into public.conversation_messages (conversation_id, business_id, direction, author, body) select id, business_id, 'out', 'owner', 'x' from public.conversations"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("update public.whatsapp_lines set status = 'online'"))).rejects.toThrow(/permission denied/);
  });

  it("staff and other businesses see nothing", async () => {
    for (const uid of [staff, stranger]) {
      await t.as(uid, async (c) => {
        expect((await c.query("select * from public.conversations")).rows).toEqual([]);
        expect((await c.query("select * from public.conversation_messages")).rows).toEqual([]);
        expect((await c.query("select * from public.whatsapp_lines")).rows).toEqual([]);
      });
    }
  });
});
