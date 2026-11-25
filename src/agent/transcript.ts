import type { AgentResponse } from "./types";

/** One message as the chat panel shows it (the model history is stored separately). */
export interface ChatItem {
  id: string;
  role: "owner" | "assistant";
  text: string;
  response?: AgentResponse;
  /** What the owner did with a preview / confirmation. */
  resolved?: "kept" | "undone" | "confirmed" | "cancelled" | "failed";
  at: string;
}

/** Most messages the model history may hold before a fresh one starts (append-only otherwise). */
export const MAX_HISTORY_MESSAGES = 60;
export const MAX_TRANSCRIPT_ITEMS = 200;
