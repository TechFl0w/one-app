/**
 * Declarations server functions are checked against ("@one/server"). Implemented by the harness
 * in src/functions/harness.ts — keep them in sync. fetch, URL, crypto etc. are the standard globals.
 */
export const SERVER_KIT_DTS = String.raw`
declare module "@one/server" {
  export type RecordData = Record<string, unknown>;
  export interface RecordRow { id: string; data: RecordData; createdAt: string; updatedAt: string }
  export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "empty" | "not_empty";
  export interface Query { table: string; filters?: { field: string; op: FilterOp; value?: string | number | boolean }[]; sort?: { field: string; dir: "asc" | "desc" }[]; limit?: number; offset?: number }

  /** This business's records (field ids from the setup). Writes don't trigger other automations. */
  export const records: {
    list(query: Query): Promise<{ records: RecordRow[]; total: number }>;
    get(table: string, id: string): Promise<RecordRow>;
    create(table: string, data: RecordData): Promise<RecordRow>;
    update(table: string, id: string, data: RecordData): Promise<RecordRow>;
  };

  /**
   * A placeholder for one of the business's saved API keys. Put it in the header the key belongs in
   * (as saved by the owner, usually Authorization); the sandbox swaps in the real key on the way out
   * to that key's host. The real key is never visible to this code.
   */
  export function secret(name: string): string;
  /** Written to the run log the owner sees. */
  export function log(...args: unknown[]): void;

  export interface RunContext {
    trigger: "automation" | "webhook" | "test";
    business: { name: string; timezone: string };
    /** The record that triggered the automation. */
    record?: { table: string; id: string; data: RecordData };
    /** The incoming request, for webhooks. */
    request?: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: string; json?: unknown };
    /** Sample input for test runs. */
    input?: unknown;
  }
  /** What a webhook function returns (anything else is sent as JSON with status 200). */
  export interface WebhookResponse { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }
}
`;
