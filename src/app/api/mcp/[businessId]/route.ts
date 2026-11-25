import { handleMcp } from "@/server/mcpHttp";

/** A business's MCP server. AI apps sign in with OAuth (Supabase Auth) or send a personal token. */
export const maxDuration = 60;
const handle = async (req: Request, ctx: RouteContext<"/api/mcp/[businessId]">) => handleMcp(req, (await ctx.params).businessId);
export { handle as GET, handle as POST, handle as DELETE };
