import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { compileFunction } from "@/codegen/compile";
import { localRunner, networkPolicy, type RunRequest } from "./runner";
import { parseOutcome } from "./harness";

let server: http.Server;
let kitUrl = "";
const calls: { method: string; args: unknown[] }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const m = JSON.parse(body) as { method: string; args: unknown[] };
      calls.push(m);
      res.setHeader("content-type", "application/json");
      if (m.method === "records.list") return res.end(JSON.stringify({ value: { records: [{ id: "r1", data: { fld_name: "Ava" }, createdAt: "", updatedAt: "" }], total: 1 } }));
      if (m.method === "records.update") return res.end(JSON.stringify({ value: { id: m.args[1], data: m.args[2], createdAt: "", updatedAt: "" } }));
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Not allowed" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  kitUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/fn/kit`;
});
afterAll(() => server.close());

const FN = `
import { records, log, secret, type RunContext } from "@one/server";
export default async function run(ctx: RunContext) {
  const { records: rows } = await records.list({ table: "tbl_clients", limit: 5 });
  log("found", rows.length, "clients");
  if (ctx.record) await records.update(ctx.record.table, ctx.record.id, { fld_note: "synced" });
  return { first: rows[0].data.fld_name, key: secret("SHIPPO") };
}`;

const req = (compiled: string, ctx: Record<string, unknown> = {}): RunRequest => ({
  compiled,
  input: { kitUrl, ctx: { trigger: "test", business: { name: "Shop", timezone: "UTC" }, ...ctx } },
  appHost: "app.example",
  runToken: "tok",
  hosts: [],
  secrets: [],
  timeoutMs: 10_000,
});

describe("server functions", () => {
  it("compile against @one/server and run in the harness", async () => {
    const c = compileFunction(FN);
    if (!c.ok) throw new Error(c.errors.join("\n"));
    const out = await localRunner.run(req(c.compiled, { record: { table: "tbl_clients", id: "r1", data: {} } }));
    expect(out).toEqual({ ok: true, value: { first: "Ava", key: "one-secret:SHIPPO" }, logs: ["found 1 clients"] });
    expect(calls.map((x) => x.method)).toEqual(["records.list", "records.update"]);
  });

  it("reports thrown errors and kit refusals with logs", async () => {
    const c = compileFunction(`import { records, log } from "@one/server";\nexport default async function run() { log("start"); await records.get("tbl_x", "1"); }`);
    if (!c.ok) throw new Error(c.errors.join("\n"));
    const out = await localRunner.run(req(c.compiled));
    expect(out).toEqual({ ok: false, error: "Not allowed", logs: ["start"] });
  });

  it("only allows @one/server imports", () => {
    const c = compileFunction(`import fs from "fs";\nexport default async function run() {}`);
    expect(c.ok).toBe(false);
  });

  it("times out runaway code", async () => {
    const c = compileFunction(`export default async function run() { while (true) {} }`);
    if (!c.ok) throw new Error(c.errors.join("\n"));
    const out = await localRunner.run({ ...req(c.compiled), timeoutMs: 1500 });
    expect(out).toMatchObject({ ok: false, error: "Timed out" });
  });

  it("firewall: One App gets the run token, keys are swapped in only for their host", () => {
    const p = networkPolicy({ ...req("x"), hosts: ["api.goshippo.com", "hooks.example.com"], secrets: [{ name: "SHIPPO", host: "api.goshippo.com", header: "Authorization", prefix: "ShippoToken ", value: "real-key" }] });
    expect(p).toEqual({
      allow: {
        "app.example": [{ transform: [{ headers: { "x-one-run": "tok" } }] }],
        "api.goshippo.com": [{ match: { headers: [{ value: { exact: "one-secret:SHIPPO" } }] }, transform: [{ headers: { authorization: "ShippoToken real-key" } }] }],
        "hooks.example.com": [],
      },
    });
  });

  it("parses odd output safely", () => {
    expect(parseOutcome("hello", "boom\nTypeError: x", 1)).toEqual({ ok: false, error: "boom\nTypeError: x", logs: [] });
  });
});
