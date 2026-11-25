import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { bearerToken } from "@/mcp/tokens";
import { buildMcpServer } from "@/mcp/server";
import { requestApproval, verifyToken } from "@/server/mcp";
import { supabaseOwnerBackend } from "@/server/ownerBackend";

/**
 * The business's MCP server (Streamable HTTP, stateless). A bearer token picks the business and
 * the owner it acts for; every call is scoped to that business. Risky calls go to Approvals.
 */
export const maxDuration = 60;

const unauthorized = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Missing or invalid token. Create one in One App → Connect AI apps." }, id: null }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="one-app"' },
  });

async function handle(req: Request): Promise<Response> {
  if (!isSupabaseConfigured()) return new Response("Not configured", { status: 503 });
  const token = bearerToken(req.headers.get("authorization"));
  if (!token) return unauthorized();
  const admin = createAdminClient("mcp");
  const owner = await verifyToken(admin, token);
  if (!owner) return unauthorized();

  const server = buildMcpServer({
    backend: supabaseOwnerBackend(admin, owner.businessId, { verifiedManager: true }),
    requestApproval: (a) => requestApproval(admin, owner, a),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
