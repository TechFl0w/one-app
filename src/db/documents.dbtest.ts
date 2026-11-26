/** Quote and invoice numbers (never repeat, per business and document) and customer links (server only). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDbUrl, type TestDb } from "./testDb";

let t: TestDb;
let alice: string;
let bob: string;
let greenline: string;
let garage: string;

describe.skipIf(!testDbUrl)("documents", () => {
  beforeAll(async () => {
    t = await setupTestDb();
    [alice, bob] = [await t.newUser(), await t.newUser()];
    greenline = await t.createBusiness(alice, "Greenline");
    garage = await t.createBusiness(bob, "Bob's Garage");
  });
  afterAll(async () => {
    await t?.close();
  });

  const next = (uid: string, biz: string, doc: string) => t.asCommit(uid, async (c) => (await c.query("select public.next_document_number($1, $2) as n", [biz, doc])).rows[0].n);

  it("numbers count up per business and per document", async () => {
    expect(await next(alice, greenline, "doc_quote")).toBe(1);
    expect(await next(alice, greenline, "doc_quote")).toBe(2);
    expect(await next(alice, greenline, "doc_invoice")).toBe(1);
    expect(await next(bob, garage, "doc_quote")).toBe(1);
  });

  it("only members can take a number", async () => {
    await expect(next(bob, greenline, "doc_quote")).rejects.toThrow(/not a member/);
    await expect(t.as(null, (c) => c.query("select public.next_document_number($1, 'doc_quote')", [greenline]))).rejects.toThrow();
    await expect(next(alice, greenline, "nope; drop table x")).rejects.toThrow(/bad document id/);
  });

  it("customer links are made by the server; members can read their own", async () => {
    await t.db.query("insert into public.document_links (token, business_id, document_id, record_id) values ($1, $2, 'doc_quote', gen_random_uuid())", ["a".repeat(32), greenline]);
    await expect(t.as(alice, (c) => c.query("insert into public.document_links (token, business_id, document_id, record_id) values ($1, $2, 'doc_quote', gen_random_uuid())", ["b".repeat(32), greenline]))).rejects.toThrow();
    await t.as(alice, async (c) => expect((await c.query("select token from public.document_links")).rows).toHaveLength(1));
    await t.as(bob, async (c) => expect((await c.query("select token from public.document_links")).rows).toEqual([]));
    await t.as(null, async (c) => expect((await c.query("select token from public.document_links")).rows).toEqual([]));
  });
});
