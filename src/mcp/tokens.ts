import { createHash, randomBytes } from "node:crypto";

/**
 * Access tokens for a business's MCP server. Shown to the owner once; only the SHA-256 is
 * stored. The prefix lets the owner tell tokens apart in the list.
 */
export const TOKEN_PREFIX = "one_";

export function newToken(): { token: string; hash: string; hint: string } {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), hint: `${token.slice(0, 8)}…${token.slice(-4)}` };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The bearer token from an Authorization header, if it looks like one of ours. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m && m[1].startsWith(TOKEN_PREFIX) && m[1].length >= 40 && m[1].length <= 80 ? m[1] : null;
}
