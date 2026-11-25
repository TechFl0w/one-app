import "server-only";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured, supabaseEnv } from "@/lib/supabase/env";
import { TOKEN_PREFIX } from "@/mcp/tokens";
import { buildMcpServer } from "@/mcp/server";
import { approvalsUrl, requestApproval, verifyToken } from "./mcp";
import { supabaseOwnerBackend } from "./ownerBackend";
import type { OwnerBackend, PendingAction } from "@/agent/types";
import { mcpBusinessUrl, resourceMetadataUrl } from "@/mcp/urls";

/**
 * Serves the MCP server over Streamable HTTP (stateless). Two ways in:
 * - OAuth (Claude.ai, ChatGPT…): a Supabase Auth access token for the owner. Calls run as that
 *   user, so RLS applies exactly as in the app. The business comes from the URL.
 * - Personal access token (one_…): for tools that take a header. The token picks the business.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unauthorized(req: Request, businessId: string | undefined, message = "Sign in to One App to connect.") {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer realm="one-app", resource_metadata="${resourceMetadataUrl(new URL(req.url).origin, businessId)}"`,
    },
  });
}

async function viaOAuth(jwt: string, businessId: string): Promise<{ backend: OwnerBackend; approve: (a: PendingAction) => Promise<{ approvalUrl: string }> } | string> {
  const { url, key } = supabaseEnv();
  const db = createSupabase(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}`, "x-one-source": "mcp" } },
  });
  const { data, error } = await db.auth.getClaims(jwt);
  const uid = data?.claims.sub;
  if (error || !uid) return "Your sign-in expired. Reconnect One App in your AI app.";
  const { data: m } = await db.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) return "Only owners and admins of this business can connect AI apps.";
  return {
    backend: supabaseOwnerBackend(db, businessId, { verifiedManager: true }),
    async approve(a) {
      const { error: e } = await db.from("agent_pending_actions").insert({ id: a.id, business_id: businessId, tool: a.tool, input: a.input, items: a.items, origin: "mcp" });
      if (e) throw new Error(`Couldn’t save the approval: ${e.message}`);
      return { approvalUrl: approvalsUrl(businessId) };
    },
  };
}

export async function handleMcp(req: Request, pathBusinessId?: string): Promise<Response> {
  if (!isSupabaseConfigured()) return new Response("Not configured", { status: 503 });
  if (pathBusinessId && !UUID.test(pathBusinessId)) return new Response("Not found", { status: 404 });
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return unauthorized(req, pathBusinessId);
  const bearer = m[1];

  let backend: OwnerBackend;
  let approve: (a: PendingAction) => Promise<{ approvalUrl: string }>;
  if (bearer.startsWith(TOKEN_PREFIX)) {
    const admin = createAdminClient("mcp");
    const owner = await verifyToken(admin, bearer);
    if (!owner || (pathBusinessId && owner.businessId !== pathBusinessId)) return unauthorized(req, pathBusinessId, "Invalid token.");
    backend = supabaseOwnerBackend(admin, owner.businessId, { verifiedManager: true });
    approve = (a) => requestApproval(admin, owner, a);
  } else {
    if (!pathBusinessId) return unauthorized(req, undefined, `Use your business’s own server URL (${mcpBusinessUrl(new URL(req.url).origin, "<business id>")}), shown under Connect AI apps.`);
    const r = await viaOAuth(bearer, pathBusinessId);
    if (typeof r === "string") return unauthorized(req, pathBusinessId, r);
    ({ backend, approve } = r);
  }

  const server = buildMcpServer({ backend, requestApproval: approve });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

