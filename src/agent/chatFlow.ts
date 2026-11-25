import type { Message } from "./ownerAgent";
import type { ChatItem } from "./transcript";

/** Small pure helpers shared by the server and demo chat actions. */

export const newItem = (role: ChatItem["role"], text: string, extra: Partial<ChatItem> = {}): ChatItem => ({
  id: crypto.randomUUID(),
  role,
  text,
  at: new Date().toISOString(),
  ...extra,
});

/** Tells the model what the owner did outside the conversation (Keep/Undo/Confirm/Cancel). */
export function withNote(history: Message[], note: string): Message[] {
  return [...history, { role: "user", content: note }];
}

export function markResolved(transcript: ChatItem[], itemId: string, resolved: ChatItem["resolved"]): ChatItem[] {
  return transcript.map((i) => (i.id === itemId ? { ...i, resolved } : i));
}

export const MISSING_KEY_TEXT =
  "The assistant isn’t switched on yet: this server has no ANTHROPIC_API_KEY. Add it to the environment and reload.";

export const hasModelCredentials = () =>
  !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
