/**
 * The AI scenarios against a real business, over its MCP server:
 *   ONE_MCP_URL=https://<app>/api/mcp/<businessId> ONE_MCP_TOKEN=one_… npm run ai-test
 *   (optional) AI_TEST_ONLY=screens,quotes
 * Use a TEST business: it adds records (pages and screens are removed again).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mcpCall, runScenarios } from "./scenarios";

const url = process.env.ONE_MCP_URL;
const token = process.env.ONE_MCP_TOKEN;

describe.skipIf(!url || !token)("AI scenarios on a live business", () => {
  it("pass", async () => {
    const client = new Client({ name: "one-app-ai-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const results = await runScenarios(mcpCall(client), { only: process.env.AI_TEST_ONLY?.split(",").filter(Boolean), log: (l) => console.log(l) });
    const report = results.map((r) => `${r.status === "passed" ? "✓" : r.status === "skipped" ? "–" : "✗"} ${r.title} (${r.ms} ms)${r.error ? `\n    ${r.error}` : ""}${r.notes.length ? `\n    ${r.notes.join("\n    ")}` : ""}`).join("\n");
    writeFileSync("ai-test-report.txt", `${new Date().toISOString()} ${url}\n\n${report}\n`);
    await client.close();
    expect(results.filter((r) => r.status === "failed").map((r) => `${r.title}: ${r.error}`)).toEqual([]);
  });
});
