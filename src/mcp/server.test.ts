import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./server";
import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import type { PendingAction } from "@/agent/types";
import { bearerToken, hashToken, newToken } from "./tokens";

async function connect() {
  const { backend } = memoryBackend({ blueprint: demoBlueprint, records: demoRecords() });
  const approvals: PendingAction[] = [];
  const server = buildMcpServer({ backend, requestApproval: async (a) => (approvals.push(a), { approvalUrl: "https://app/approvals" }), now: () => new Date("2026-11-26T18:00:00Z") });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, backend, approvals };
}
const body = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text);

describe("MCP server", () => {
  it("lists the owner agent's tools plus get_setup", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("get_setup");
    expect(names).toContain("query_records");
    expect(names).toContain("delete_record");
    expect(tools.every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("runs safe tools and validates input", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "query_records", arguments: { table: "tbl_clients", limit: 2 } });
    expect(r.isError).toBeFalsy();
    expect(body(r).records.length).toBe(2);
    const bad = await client.callTool({ name: "query_records", arguments: { table: "nope" } });
    expect(bad.isError).toBe(true);
    const setup = await client.callTool({ name: "get_setup", arguments: {} });
    expect((setup.content as { text: string }[])[0].text).toContain("tbl_clients");
  });

  it("never runs risky tools — sends them for approval", async () => {
    const { client, backend, approvals } = await connect();
    const { records } = await backend.query({ table: "tbl_clients", limit: 1 });
    const r = await client.callTool({ name: "delete_record", arguments: { table: "tbl_clients", id: records[0].id } });
    expect(body(r).status).toBe("sent_to_owner_for_approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0].tool).toBe("delete_record");
    await expect(backend.getRecord("tbl_clients", records[0].id)).resolves.toBeTruthy();
  });
});

describe("tokens", () => {
  it("makes unguessable tokens stored only as hashes", () => {
    const a = newToken();
    const b = newToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toHaveLength(64);
    expect(bearerToken(`Bearer ${a.token}`)).toBe(a.token);
    expect(bearerToken("Bearer sk_other")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("stateless HTTP", () => {
  it("answers initialize and tools/call as separate requests (one server per request, like the route)", async () => {
    const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const { backend } = memoryBackend({ blueprint: demoBlueprint, records: demoRecords() });
    const post = async (body: unknown) => {
      const server = buildMcpServer({ backend, requestApproval: async () => ({ approvalUrl: "x" }) });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      const res = await transport.handleRequest(
        new Request("https://app/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify(body) }),
      );
      await server.close();
      return res.json();
    };
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.result.serverInfo.name).toBe("one-app");
    const call = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "query_records", arguments: { table: "tbl_services", limit: 1 } } });
    expect(JSON.parse(call.result.content[0].text).records).toHaveLength(1);
  });
});

describe("OAuth discovery", () => {
  it("points AI apps at Supabase Auth for this business's server", async () => {
    const { protectedResourceMetadata, resourceMetadataUrl } = await import("./urls");
    expect(resourceMetadataUrl("https://app.one", "b1")).toBe("https://app.one/.well-known/oauth-protected-resource/api/mcp/b1");
    expect(protectedResourceMetadata("https://app.one", "/api/mcp/b1", "https://ref.supabase.co/")).toEqual({
      resource: "https://app.one/api/mcp/b1",
      authorization_servers: ["https://ref.supabase.co/auth/v1"],
      bearer_methods_supported: ["header"],
      resource_name: "One App",
    });
  });
});
