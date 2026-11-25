/** Public URLs for the MCP server and its OAuth discovery documents (RFC 9728). */
export const mcpBusinessUrl = (origin: string, businessId: string) => `${origin}/api/mcp/${businessId}`;

export const resourceMetadataUrl = (origin: string, businessId?: string) =>
  `${origin}/.well-known/oauth-protected-resource/api/mcp${businessId ? `/${businessId}` : ""}`;

/** Supabase Auth is the authorization server (its OAuth 2.1 server issues the tokens). */
export const authorizationServer = (supabaseUrl: string) => `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;

export function protectedResourceMetadata(origin: string, resourcePath: string, supabaseUrl: string) {
  return {
    resource: `${origin}${resourcePath}`,
    authorization_servers: [authorizationServer(supabaseUrl)],
    bearer_methods_supported: ["header"],
    resource_name: "One App",
  };
}
