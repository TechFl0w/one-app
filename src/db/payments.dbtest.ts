/** Payment tables: Stripe state is written by the server only; owners/admins read. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let owner: string;
let staff: string;
let biz: string;

describe.skipIf(!testDbUrl)("payments storage", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [owner, staff] = [await t.newUser(), await t.newUser()];
    biz = await t.createBusiness(owner, "Salon");
    await t.db.query("insert into public.memberships (business_id, user_id, role) values ($1, $2, 'staff')", [biz, staff]);
    await t.db.query("insert into public.business_payments (business_id, stripe_account_id, charges_enabled) values ($1, 'acct_1', true)", [biz]);
    await t.db.query("insert into public.payments (business_id, kind, amount, currency, description) values ($1, 'deposit', 11, 'CAD', 'Deposit')", [biz]);
  });

  afterAll(async () => {
    await t?.close();
  });

  it("owners read; staff don't; nobody can forge a paid status", async () => {
    await t.as(owner, async (c) => {
      expect((await c.query("select status from public.payments")).rows).toEqual([{ status: "pending" }]);
      expect((await c.query("select charges_enabled from public.business_payments")).rows).toEqual([{ charges_enabled: true }]);
    });
    await t.as(staff, async (c) => expect((await c.query("select * from public.payments")).rows).toEqual([]));
    await expect(t.as(owner, (c) => c.query("update public.payments set status = 'paid'"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("update public.business_payments set charges_enabled = false"))).rejects.toThrow(/permission denied/);
    await expect(t.as(owner, (c) => c.query("insert into public.payments (business_id, kind, amount, currency, description) values ($1, 'payment', 5, 'CAD', 'x')", [biz]))).rejects.toThrow(/permission denied/);
  });

  it("checks amounts and currencies", async () => {
    await expect(t.db.query("insert into public.payments (business_id, kind, amount, currency, description) values ($1, 'payment', 0, 'CAD', 'x')", [biz])).rejects.toThrow(/check constraint/);
    await expect(t.db.query("insert into public.payments (business_id, kind, amount, currency, description) values ($1, 'payment', 5, 'cad', 'x')", [biz])).rejects.toThrow(/check constraint/);
  });
});
