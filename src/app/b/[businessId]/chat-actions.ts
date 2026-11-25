"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { cleanImages, runConfirmedAction, runOwnerTurn, withoutImages } from "@/agent/ownerAgent";
import { hasModelCredentials, markResolved, MISSING_KEY_TEXT, newItem, withNote } from "@/agent/chatFlow";
import type { ChatItem } from "@/agent/transcript";
import { supabaseOwnerBackend } from "@/server/ownerBackend";
import { historyForNextTurn, loadConversation, loadPending, resolvePending, savePending, saveConversation } from "@/server/ownerChat";
import { undoBlueprintChange } from "./actions";

/** Chat panel server actions for a real business. The caller is the signed-in user (RLS). */

export type ChatResult = { ok: true; transcript: ChatItem[]; changed: boolean } | { ok: false; error: string };

async function session(businessId: string) {
  const supabase = await createClient({ source: "ai" });
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub as string | undefined;
  if (!userId) throw new Error("Please sign in again.");
  return { supabase, userId, backend: supabaseOwnerBackend(supabase, businessId) };
}

const fail = (e: unknown): ChatResult => {
  console.error(e);
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
};

export async function sendOwnerMessage(businessId: string, pageId: string | undefined, text: string, rawImages?: unknown, shown?: string): Promise<ChatResult> {
  const images = cleanImages(rawImages);
  const message = text.trim().slice(0, 4000) || (images.length ? "Here’s a design — make the app look like this." : "");
  if (!message) return { ok: false, error: "Type a message first." };
  try {
    const { supabase, userId, backend } = await session(businessId);
    const convo = await loadConversation(supabase, businessId, userId);
    // `shown`: what the chat displays for this message (e.g. "Checking how it looks…" for the self-check).
    const display = shown ? shown.slice(0, 200) : images.length ? `${message}\n[${images.length} image${images.length > 1 ? "s" : ""} attached]` : message;
    const transcript = [...convo.transcript, newItem("owner", display)];
    if (!hasModelCredentials()) {
      transcript.push(newItem("assistant", MISSING_KEY_TEXT));
      await saveConversation(supabase, businessId, userId, convo.history, transcript);
      return { ok: true, transcript, changed: false };
    }
    const turn = await runOwnerTurn({ backend, history: historyForNextTurn(convo.history), message, pageId, images });
    await savePending(supabase, businessId, turn.pending);
    transcript.push(newItem("assistant", turn.response.text, { response: turn.response }));
    await saveConversation(supabase, businessId, userId, withoutImages(turn.history), transcript);
    if (turn.response.changed) revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, transcript, changed: turn.response.changed };
  } catch (e) {
    return fail(e);
  }
}

/** Confirm or cancel the risky actions attached to a chat message. Runs them in code, not via the model. */
export async function resolveConfirmation(businessId: string, itemId: string, decision: "confirm" | "cancel"): Promise<ChatResult> {
  try {
    const { supabase, userId, backend } = await session(businessId);
    const convo = await loadConversation(supabase, businessId, userId);
    const item = convo.transcript.find((i) => i.id === itemId);
    const ids = item?.response?.confirm?.actionIds ?? [];
    if (!item || item.resolved || !ids.length) return { ok: false, error: "This was already handled." };

    const actions = await loadPending(supabase, businessId, ids);
    let history = convo.history;
    let changed = false;
    let failed = false;
    const reports: string[] = [];
    if (decision === "cancel") {
      await resolvePending(supabase, ids, "cancelled");
      history = withNote(history, `[The owner cancelled: ${item.response!.confirm!.items.join("; ")}]`);
    } else {
      const notes: string[] = [];
      for (const a of actions) {
        const r = await runConfirmedAction(backend, a);
        changed ||= !!r.effects.changed;
        failed ||= !r.ok;
        notes.push(r.note);
        if (r.report) reports.push(r.report);
        await resolvePending(supabase, [a.id], r.note.includes("failed") ? "failed" : "confirmed");
      }
      history = withNote(history, notes.join("\n"));
    }
    const resolved = decision === "cancel" ? "cancelled" : failed ? "failed" : "confirmed";
    // Results worth showing (e.g. a test run's output) appear as an assistant message.
    const transcript = [
      ...markResolved(convo.transcript, itemId, resolved),
      ...reports.map((text) => ({ id: crypto.randomUUID(), role: "assistant" as const, text, at: new Date().toISOString() })),
    ];
    await saveConversation(supabase, businessId, userId, history, transcript);
    if (changed) revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, transcript, changed };
  } catch (e) {
    return fail(e);
  }
}

/** Keep or Undo a setup change the assistant made. */
export async function resolvePreview(businessId: string, itemId: string, decision: "keep" | "undo"): Promise<ChatResult> {
  try {
    const { supabase, userId } = await session(businessId);
    const convo = await loadConversation(supabase, businessId, userId);
    const item = convo.transcript.find((i) => i.id === itemId);
    const undo = item?.response?.preview?.undo;
    if (!item || item.resolved || !undo) return { ok: false, error: "This was already handled." };
    let history = convo.history;
    if (decision === "undo") {
      if (!("historyId" in undo)) return { ok: false, error: "This change can’t be undone here." };
      const r = await undoBlueprintChange(businessId, undo.historyId, true);
      if (!r.ok) return { ok: false, error: r.error };
      history = withNote(history, `[The owner undid this change: ${item.response!.preview!.summary}]`);
    }
    const transcript = markResolved(convo.transcript, itemId, decision === "undo" ? "undone" : "kept");
    await saveConversation(supabase, businessId, userId, history, transcript);
    return { ok: true, transcript, changed: decision === "undo" };
  } catch (e) {
    return fail(e);
  }
}
