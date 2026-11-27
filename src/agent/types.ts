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
  /** What other businesses of this type changed after setup (approved in the control center). */
  learnings?(): Promise<string>;
  /** The public online booking page, when the business takes online bookings. */
  bookingPageUrl?(): Promise<string | null>;
  query(q: RecordQuery): Promise<{ records: RecordRow[]; total: number }>;
  getRecord(tableId: string, id: string): Promise<RecordRow>;
  createRecord(tableId: string, input: Record<string, unknown>): Promise<RecordRow>;
  /** `confirmed` is required for risky updates (price changes, see engine/risk.ts). */
  updateRecord(tableId: string, id: string, input: Record<string, unknown>, opts?: { confirmed?: boolean }): Promise<RecordRow>;
  /** Only called after the owner confirmed. */
  deleteRecord(tableId: string, id: string): Promise<void>;
  commitChangeSet(changeSet: ChangeSet, confirmed: boolean): Promise<CommitResult>;
  /** Stripe payments; missing when payments aren't available (demo, not configured). */
  payments?: PaymentsBackend;
  /** Generated server code; missing where it can't run (demo, not configured). */
  functions?: FunctionsBackend;
}

export interface FunctionsBackend {
  /** Names and hosts of the business's saved API keys (never the values). */
  apiKeys(): Promise<{ name: string; host: string; header: string }[]>;
  /** Only called after the owner confirmed (it can call outside services and change data). */
  test(functionId: string, input: unknown): Promise<{ ok: boolean; value?: unknown; error?: string; logs: string[] }>;
}

export interface PaymentsBackend {
  createLink(input: { kind: "payment" | "subscription"; amount: number; currency: string; description: string; interval?: "week" | "month"; tableId?: string; recordId?: string; email?: string }): Promise<{ paymentId: string; url: string }>;
  list(limit: number): Promise<{ id: string; kind: string; amount: number; currency: string; description: string; status: string; created_at: string; record_id: string | null }[]>;
  /** Only called after the owner confirmed. */
  refund(paymentId: string): Promise<void>;
}

export interface BuildPlan {
  goal: string;
  /** images: 1-based numbers of the owner's screenshots this step reproduces (only those are sent again). */
  steps: { id: string; title: string; done: boolean; images?: number[] }[];
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
  /** Components to picture and send back for a self-check (in-app chat only). */
  verify?: { componentId: string; pageId?: string }[];
  /** A multi-step build (e.g. recreating an app from screenshots); the chat continues it automatically. */
  plan?: BuildPlan;
}
