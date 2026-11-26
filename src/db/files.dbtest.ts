/** Record files in Supabase Storage: each business's folder is readable and writable by its members only. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let alice: string;
let bob: string;
let salon: string;
let garage: string;

describe.skipIf(!testDbUrl)("record files", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [alice, bob] = [await t.newUser(), await t.newUser()];
    salon = await t.createBusiness(alice, "Alice's Salon");
    garage = await t.createBusiness(bob, "Bob's Garage");
    await t.db.query("insert into storage.objects (bucket_id, name) values ('record-files', $1)", [`${garage}/tbl_photos/x/van.jpg`]);
  });
  afterAll(async () => {
    await t?.close();
  });

  it("is a private bucket", async () => {
    const r = await t.db.query("select public, file_size_limit from storage.buckets where id = 'record-files'");
    expect(r.rows).toEqual([{ public: false, file_size_limit: "20971520" }]);
  });

  it("members upload into their own business's folder only", async () => {
    await t.as(alice, async (c) => {
      await c.query("insert into storage.objects (bucket_id, name) values ('record-files', $1)", [`${salon}/tbl_photos/a/chair.jpg`]);
    });
    await expect(t.as(alice, (c) => c.query("insert into storage.objects (bucket_id, name) values ('record-files', $1)", [`${garage}/tbl_photos/a/x.jpg`]))).rejects.toThrow(/row-level security/);
    await expect(t.as(alice, (c) => c.query("insert into storage.objects (bucket_id, name) values ('record-files', 'not-a-business/a/b/c.jpg')"))).rejects.toThrow(/row-level security/);
    await expect(t.as(null, (c) => c.query("insert into storage.objects (bucket_id, name) values ('record-files', $1)", [`${salon}/t/a/x.jpg`]))).rejects.toThrow();
  });

  it("nobody sees another business's files", async () => {
    await t.as(alice, async (c) => {
      const r = await c.query("select name from storage.objects where bucket_id = 'record-files'");
      expect(r.rows).toEqual([]);
    });
    await t.as(bob, async (c) => {
      const r = await c.query("select name from storage.objects where bucket_id = 'record-files'");
      expect(r.rows.map((x) => x.name)).toEqual([`${garage}/tbl_photos/x/van.jpg`]);
    });
  });
});
