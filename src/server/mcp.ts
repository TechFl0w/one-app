import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PendingAction } from "@/agent/types";
import { hashToken, newToken } from "@/mcp/tokens";

/** Token storage and approvals for the business MCP server (service role; role checked here). */

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
export const mcpUrl = () => `${appUrl()}/api/mcp`;
export const approvalsUrl = (businessId: string) => `${appUrl()}/b/${businessId}/approvals`;

export interface TokenOwner {
  tokenId: string;
  businessId: string;
  userId: string;
}

/** The business + user a token acts for — only while it's not revoked and the user is still an owner/admin. */
export async function verifyToken(admin: SupabaseClient, token: string): Promise<TokenOwner | null> {
  const { data: t } = await admin.from("api_tokens").select("id, business_id, user_id, last_used_at").eq("token_hash", hashToken(token)).is("revoked_at", null).maybeSingle();
  if (!t) return null;
  const { data: m } = await admin.from("memberships").select("role").eq("business_id", t.business_id).eq("user_id", t.user_id).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) return null;
  // Touch at most once a minute.
  if (!t.last_used_at || Date.now() - Date.parse(t.last_used_at) > 60_000) {
    await admin.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", t.id);
  }
  return { tokenId: t.id, businessId: t.business_id, userId: t.user_id };
}

export async function createToken(admin: SupabaseClient, businessId: string, userId: string, name: string) {
  const { count } = await admin.from("api_tokens").select("id", { count: "exact", head: true }).eq("business_id", businessId).is("revoked_at", null);
  if ((count ?? 0) >= 20) throw new Error("You have 20 active connections — remove one first.");
  const t = newToken();
  const { error } = await admin.from("api_tokens").insert({ business_id: businessId, user_id: userId, name: name.slice(0, 60), token_hash: t.hash, hint: t.hint });
  if (error) throw new Error(error.message);
  return t.token;
}

export async function revokeToken(admin: SupabaseClient, businessId: string, userId: string, id: string) {
  await admin.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("business_id", businessId).eq("user_id", userId).eq("id", id).is("revoked_at", null);
}

/** Parks a risky MCP call for the token's owner to approve in One App. */
export async function requestApproval(admin: SupabaseClient, owner: TokenOwner, action: PendingAction) {
  const { error } = await admin.from("agent_pending_actions").insert({
    id: action.id, business_id: owner.businessId, user_id: owner.userId, tool: action.tool, input: action.input, items: action.items, origin: "mcp",
  });
  if (error) throw new Error(`Couldn’t save the approval: ${error.message}`);
  return { approvalUrl: approvalsUrl(owner.businessId) };
}
