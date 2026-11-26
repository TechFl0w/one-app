import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { executeOwnerTool, ownerToolDefinitions, type ToolEffects } from "@/agent/ownerTools";
import { buildGuide, setupSummary } from "@/agent/ownerAgent";
import type { OwnerBackend, PendingAction } from "@/agent/types";

/**
 * A business's MCP server: the owner agent's tools, nothing more (CLAUDE.md rule 5). Risky calls
 * never run here — they're handed to `requestApproval` and the owner confirms them in One App.
 */
export function buildMcpServer(input: {
  backend: OwnerBackend;
  requestApproval: (action: PendingAction) => Promise<{ approvalUrl: string }>;
  newId?: () => string;
  now?: () => Date;
}): Server {
  const { backend, requestApproval, newId = () => crypto.randomUUID(), now = () => new Date() } = input;
  const server = new Server(
    { name: "one-app", version: "1.0.0" },
    { capabilities: { tools: {} }, instructions: "Tools for running this small business in One App: its records, setup, bookings, automations and payments. Call get_setup first, and get_build_guide before building screens, components or server code. Risky actions (deleting, refunds, price or automation changes) are sent to the owner to approve in One App." },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "get_setup", description: "Summary of the business's setup: tables with field ids, pages, automations, today's date.", inputSchema: { type: "object", properties: {} } },
      { name: "get_build_guide", description: "How to build in One App: the component kit (@one/kit) API, app rules every screen follows, design guidance, recreating an app from screenshots, and the server kit. Read before write_component, plan_build or write_function.", inputSchema: { type: "object", properties: {} } },
      ...ownerToolDefinitions().map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema as { type: "object"; [k: string]: unknown } })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const text = (v: unknown, isError = false): CallToolResult => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }], ...(isError ? { isError: true } : {}) });
    if (req.params.name === "get_setup") return text(setupSummary(await backend.blueprint(), now()));
    if (req.params.name === "get_build_guide") return text(buildGuide({ renderCheck: false }));
    const effects: ToolEffects = {};
    const out = await executeOwnerTool(req.params.name, req.params.arguments, backend, effects, newId);
    if (out.kind === "error") return text(out.message, true);
    if (out.kind === "pending") {
      const { approvalUrl } = await requestApproval(out.action);
      if (out.applied !== undefined)
        return text({ status: "partly_applied", applied_now: effects.preview ? { result: out.applied, applied: effects.preview.summary } : out.applied, waiting_for_approval: out.action.items, approve_at: approvalUrl, note: "The safe part is done. Tell the owner to approve the rest in One App." });
      return text({ status: "sent_to_owner_for_approval", will_do: out.action.items, approve_at: approvalUrl, note: "Nothing has happened yet. Tell the owner to approve it in One App." });
    }
    // Blueprint changes are applied right away (they're undoable in One App's history).
    return text(effects.preview ? { result: out.value, applied: effects.preview.summary } : out.value);
  });

  return server;
}
