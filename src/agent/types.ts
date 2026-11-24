import type { Blueprint } from "@/schema/blueprint";
import type { ChangeSet } from "@/schema/changeSet";
import type { RecordQuery, RecordRow } from "@/schema/records";
import type { CommitResult, UndoToken } from "@/engine/commit";
import type { OpPreview } from "@/engine/changeSet";

/**
 * What the owner agent can do to a business. The same surface will back the business's MCP
 * server (CLAUDE.md rule 5). Implementations enforce permissions themselves (Supabase RLS, or
 * the in-memory demo), so a tool can never reach further than the signed-in owner can.
 */
export interface OwnerBackend {
  blueprint(): Promise<Blueprint>;
  query(q: RecordQuery): Promise<{ records: RecordRow[]; total: number }>;
  getRecord(tableId: string, id: string): Promise<RecordRow>;
  createRecord(tableId: string, input: Record<string, unknown>): Promise<RecordRow>;
  updateRecord(tableId: string, id: string, input: Record<string, unknown>): Promise<RecordRow>;
  /** Only called after the owner confirmed. */
  deleteRecord(tableId: string, id: string): Promise<void>;
  commitChangeSet(changeSet: ChangeSet, confirmed: boolean): Promise<CommitResult>;
}

/** A risky tool call held back until the owner confirms it (executed by code, not the model). */
export interface PendingAction {
  id: string;
  tool: string;
  input: unknown;
  /** Plain-language lines shown in the confirmation. */
  items: string[];
}

/**
 * Structured reply, so the in-app chat renders UI and WhatsApp/Telegram can later render
 * text + buttons (CLAUDE.md rule 6).
 */
export interface AgentResponse {
  text: string;
  /** A blueprint change the agent applied this turn; owner can Keep or Undo. */
  preview?: { summary: string; ops: OpPreview[]; undo: UndoToken };
  /** Risky actions waiting for the owner. */
  confirm?: { items: string[]; actionIds: string[] };
  buttons?: { label: string; action: "keep" | "undo" | "confirm" | "cancel" }[];
  /** Data or setup changed: the UI should refresh. */
  changed: boolean;
}
