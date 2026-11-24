import type { Blueprint } from "@/schema/blueprint";
import type { ChangeSet } from "@/schema/changeSet";
import { ChangeSetError, type ChangeSetResult } from "./changeSet";

/** What saving or undoing a change set returns to Edit mode (shared by server and local mode). */
export type CommitResult =
  | { ok: true; blueprint: Blueprint; undo: UndoToken; summary: string }
  | { ok: false; needsConfirmation?: string[]; error: string; conflict?: boolean };

/** How to undo the change just saved: a history entry (server) or the inverse (local/demo). */
export type UndoToken = { historyId: string } | { inverse: ChangeSet };

export function okResult(r: ChangeSetResult, undo: UndoToken): CommitResult {
  return { ok: true, blueprint: r.blueprint, undo, summary: summarize(r.ops.map((o) => o.description)) };
}

export function errorResult(e: unknown, risky?: string[]): CommitResult {
  if (e instanceof ChangeSetError) {
    if (e.code === "needs_confirmation") return { ok: false, needsConfirmation: risky ?? [e.message], error: e.message };
    return { ok: false, error: e.message, conflict: e.code === "conflict" };
  }
  console.error(e);
  return { ok: false, error: "Couldn't save. Please try again." };
}

/** "Move a block on “Today” (×3); Hide page “Services”" */
export function summarize(descriptions: string[]): string {
  const counts = new Map<string, number>();
  descriptions.forEach((d) => counts.set(d, (counts.get(d) ?? 0) + 1));
  return [...counts].map(([d, n]) => (n > 1 ? `${d} (×${n})` : d)).join("; ");
}
