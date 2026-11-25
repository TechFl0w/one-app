import { handleMcp } from "@/server/mcpHttp";

/** MCP server for personal access tokens (the token picks the business). OAuth uses /api/mcp/<businessId>. */
export const maxDuration = 60;
const handle = (req: Request) => handleMcp(req);
export { handle as GET, handle as POST, handle as DELETE };
