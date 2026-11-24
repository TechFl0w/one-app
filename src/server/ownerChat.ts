import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/agent/ownerAgent";
import type { PendingAction } from "@/agent/types";
import { MAX_HISTORY_MESSAGES, MAX_TRANSCRIPT_ITEMS, type ChatItem } from "@/agent/transcript";

/** Storage for the owner's conversation and pending confirmations (RLS: own rows only). */

export async function loadConversation(supabase: SupabaseClient, businessId: string, userId: string) {
  const { data, error } = await supabase
    .from("owner_conversations")
    .select("history, transcript")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load chat: ${error.message}`);
  return { history: (data?.history ?? []) as Message[], transcript: (data?.transcript ?? []) as ChatItem[] };
}

export async function saveConversation(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  history: Message[],
  transcript: ChatItem[],
) {
  const { error } = await supabase.from("owner_conversations").upsert(
    {
      business_id: businessId,
      user_id: userId,
      history,
      transcript: transcript.slice(-MAX_TRANSCRIPT_ITEMS),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id,user_id" },
  );
  if (error) throw new Error(`Could not save chat: ${error.message}`);
}

/**
 * History the next turn starts from. The model history is only ever appended to (edits would
 * break preserved thinking); when it gets long, the next turn starts a fresh one.
 */
export function historyForNextTurn(history: Message[]): Message[] {
  return history.length > MAX_HISTORY_MESSAGES ? [] : history;
}

export async function savePending(supabase: SupabaseClient, businessId: string, actions: PendingAction[]) {
  if (!actions.length) return;
  const { error } = await supabase
    .from("agent_pending_actions")
    .insert(actions.map((a) => ({ id: a.id, business_id: businessId, tool: a.tool, input: a.input, items: a.items })));
  if (error) throw new Error(`Could not save confirmation: ${error.message}`);
}

export async function loadPending(supabase: SupabaseClient, businessId: string, ids: string[]): Promise<PendingAction[]> {
  const { data, error } = await supabase
    .from("agent_pending_actions")
    .select("id, tool, input, items")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .in("id", ids);
  if (error) throw new Error(`Could not load confirmation: ${error.message}`);
  return (data ?? []) as PendingAction[];
}

export async function resolvePending(supabase: SupabaseClient, ids: string[], status: "confirmed" | "cancelled" | "failed") {
  if (!ids.length) return;
  const { error } = await supabase
    .from("agent_pending_actions")
    .update({ status, resolved_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending");
  if (error) throw new Error(`Could not update confirmation: ${error.message}`);
}
