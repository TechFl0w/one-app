"use server";

import { Blueprint } from "@/schema/blueprint";
import { runConfirmedAction, runOwnerTurn, type Message } from "@/agent/ownerAgent";
import { memoryBackend } from "@/agent/memoryBackend";
import { hasModelCredentials, MISSING_KEY_TEXT } from "@/agent/chatFlow";
import type { AgentResponse, PendingAction } from "@/agent/types";
import { demoRecords } from "@/demo/salon";

/**
 * Demo chat: the browser keeps the conversation, pending actions and blueprint (nothing is
 * stored). Each call rebuilds an in-memory business from the browser's blueprint + sample data.
 */

export type DemoChatResult =
  | { ok: true; response: AgentResponse; history: Message[]; pending: PendingAction[]; blueprint: Blueprint }
  | { ok: false; error: string };

const MAX_DEMO_HISTORY = 40;

export async function sendDemoMessage(blueprint: unknown, history: Message[], text: string, pageId?: string): Promise<DemoChatResult> {
  const bp = Blueprint.safeParse(blueprint);
  if (!bp.success) return { ok: false, error: "The demo got out of sync. Reload the page." };
  const message = text.trim().slice(0, 2000);
  if (!message) return { ok: false, error: "Type a message first." };
  if (!hasModelCredentials()) {
    return { ok: true, response: { text: MISSING_KEY_TEXT, changed: false }, history, pending: [], blueprint: bp.data };
  }
  try {
    const { backend, state } = memoryBackend({ blueprint: bp.data, records: demoRecords() });
    const turn = await runOwnerTurn({ backend, history: Array.isArray(history) && history.length <= MAX_DEMO_HISTORY ? history : [], message, pageId });
    return { ok: true, response: turn.response, history: turn.history, pending: turn.pending, blueprint: state.blueprint };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "The assistant couldn’t answer just now." };
  }
}

export async function confirmDemoActions(blueprint: unknown, actions: PendingAction[]): Promise<{ ok: true; blueprint: Blueprint; notes: string[] } | { ok: false; error: string }> {
  const bp = Blueprint.safeParse(blueprint);
  if (!bp.success) return { ok: false, error: "The demo got out of sync. Reload the page." };
  const { backend, state } = memoryBackend({ blueprint: bp.data, records: demoRecords() });
  const notes: string[] = [];
  for (const a of actions.slice(0, 10)) notes.push((await runConfirmedAction(backend, a)).note);
  return { ok: true, blueprint: state.blueprint, notes };
}
