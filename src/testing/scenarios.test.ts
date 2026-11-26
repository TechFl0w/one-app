/** The AI feature scenarios, against each template's own MCP server in memory (no live data). */
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "@/mcp/server";
import { memoryBackend } from "@/agent/memoryBackend";
import { TEMPLATES } from "@/templates";
import { resolveSeed } from "@/templates/types";
import type { RecordRow } from "@/schema/records";
import { mcpCall, runScenarios } from "./scenarios";

async function connect(templateId: string) {
  const t = TEMPLATES.find((x) => x.id === templateId)!;
  const { blueprint, seed } = t.build({ name: "AI Test Co", timezone: "America/Vancouver" }, {});
  const ids = new Map<string, string>();
  const records: RecordRow[] = seed.map((s, i) => {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const row = { id, tableId: s.table, data: resolveSeed(s.data, ids), createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
    if (s.ref) ids.set(s.ref, id);
    return row;
  });
  const { backend } = memoryBackend({ blueprint, records });
  const server = buildMcpServer({ backend, requestApproval: async () => ({ approvalUrl: "https://one.app/approve/test" }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "ai-test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe.each(TEMPLATES.map((t) => [t.id] as const))("AI scenarios on the %s template", (id) => {
  it("pass (or skip when the template doesn't have the feature)", async () => {
    const results = await runScenarios(mcpCall(await connect(id)), { only: process.env.AI_TEST_ONLY?.split(",").filter(Boolean), log: process.env.AI_TEST_LOG ? (l) => console.log(l) : undefined });
    if (process.env.AI_TEST_LOG) for (const r of results) console.log(r.id, r.status, r.notes.join(" | "));
    const failed = results.filter((r) => r.status === "failed");
    expect(failed.map((f) => `${f.title}: ${f.error}`)).toEqual([]);
    if (id === "mechanic") expect(results.find((r) => r.id === "mechanic")?.status).toBe("passed");
    if (id === "contractor") expect(results.find((r) => r.id === "quotes")?.status).toBe("passed");
  }, 60_000);
});
