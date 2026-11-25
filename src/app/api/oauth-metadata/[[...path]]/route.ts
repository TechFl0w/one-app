import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabaseEnv } from "@/lib/supabase/env";
import { protectedResourceMetadata } from "@/mcp/urls";

/**
 * OAuth Protected Resource Metadata (RFC 9728), served at /.well-known/oauth-protected-resource/…
 * via a rewrite. Tells AI apps that Supabase Auth signs people in for this MCP server.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/oauth-metadata/[[...path]]">) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const path = (await ctx.params).path ?? [];
  const resourcePath = path.length ? `/${path.join("/")}` : "/api/mcp";
  const origin = new URL(req.url).origin;
  return NextResponse.json(protectedResourceMetadata(origin, resourcePath, supabaseEnv().url), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
