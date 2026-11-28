"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { EditContext, type Confirm, type EditContextValue } from "./editContext";
export { useEdit, useEditOptional } from "./editContext";
import { useRouter } from "next/navigation";
import type { Blueprint } from "@/schema/blueprint";
import type { ChangeSet, Operation } from "@/schema/changeSet";
import { applyChangeSet, ChangeSetError, previewChangeSet, undoChangeSet } from "@/engine/changeSet";
import { errorResult, okResult, type CommitResult, type UndoToken } from "@/engine/commit";
import { compactOps, riskyOps } from "@/engine/editing";
import { saveBlueprintChanges, undoBlueprintChange } from "@/app/b/[businessId]/actions";

/**
 * Edit mode state for one business. UI edits push change-set ops; the draft blueprint is the
 * live preview (pure applyChangeSet). "Done" saves them as one change set, "Discard" drops them.
 * mode "server" persists through server actions; "local" (demo) keeps changes in the browser.
 */

export type EditMode = { kind: "server"; businessId: string } | { kind: "local" };

export function EditProvider({ blueprint: fromServer, mode, children }: { blueprint: Blueprint; mode: EditMode; children: React.ReactNode }) {
  const router = useRouter();
  const [base, setBase] = useState(fromServer);
  const [seenServerVersion, setSeenServerVersion] = useState(fromServer.version);
  const [editing, setEditing] = useState(false);
  const [ops, setOps] = useState<Operation[]>([]);
  const [draft, setDraft] = useState<Blueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [lastSaved, setLastSaved] = useState<{ summary: string; undo: UndoToken } | null>(null);
  const [busy, startTransition] = useTransition();

  // A newer blueprint from the server (after refresh / someone else's change) becomes the base.
  if (fromServer.version !== seenServerVersion) {
    setSeenServerVersion(fromServer.version);
    if (fromServer.version > base.version) setBase(fromServer);
  }

  const changeSet = useCallback(
    (list: Operation[]): ChangeSet => ({ baseVersion: base.version, source: "ui", ops: list }),
    [base.version],
  );

  const reset = useCallback(() => {
    setOps([]);
    setDraft(null);
    setError(null);
    setConfirm(null);
  }, []);

  const push = useCallback(
    (add: Operation | Operation[]) => {
      const next = compactOps([...ops, ...(Array.isArray(add) ? add : [add])]);
      if (!next.length) return true;
      const p = previewChangeSet(base, changeSet(next));
      if (!p.ok) {
        setError(p.error.message);
        return false;
      }
      setOps(next);
      setDraft(p.blueprint);
      setError(null);
      return true;
    },
    [ops, base, changeSet],
  );

  const finish = useCallback(
    (r: CommitResult, purpose: "save" | "undo") => {
      if (!r.ok) {
        if (r.needsConfirmation) setConfirm({ purpose, items: r.needsConfirmation });
        else setError(r.conflict ? "Someone else changed this business just now. Reload to see their changes." : r.error);
        return;
      }
      setBase(r.blueprint);
      reset();
      setEditing(false);
      setLastSaved(purpose === "save" ? { summary: r.summary, undo: r.undo } : null);
      if (mode.kind === "server") router.refresh();
    },
    [mode, reset, router],
  );

  const save = useCallback(
    (confirmed = false) => {
      if (!ops.length) {
        reset();
        setEditing(false);
        return;
      }
      const cs = changeSet(ops);
      setConfirm(null);
      if (mode.kind === "server") {
        startTransition(async () => finish(await saveBlueprintChanges(mode.businessId, cs, confirmed), "save"));
        return;
      }
      const p = previewChangeSet(base, cs);
      if (p.ok && p.requiresConfirmation && !confirmed) return finish(errorResult(new ChangeSetError("needs_confirmation", ""), riskyOps(p)), "save");
      try {
        const r = applyChangeSet(base, cs, { confirmed });
        finish(okResult(r, { inverse: r.inverse }), "save");
      } catch (e) {
        finish(errorResult(e), "save");
      }
    },
    [ops, mode, base, changeSet, finish, reset],
  );

  const undo = useCallback(
    (confirmed = false) => {
      if (!lastSaved) return;
      setConfirm(null);
      const token = lastSaved.undo;
      if ("historyId" in token) {
        if (mode.kind !== "server") return;
        startTransition(async () => finish(await undoBlueprintChange(mode.businessId, token.historyId, confirmed), "undo"));
        return;
      }
      try {
        const r = undoChangeSet(base, token.inverse, { confirmed });
        finish(okResult(r, { inverse: r.inverse }), "undo");
      } catch (e) {
        const risky = e instanceof ChangeSetError && e.code === "needs_confirmation" ? [e.message.replace(/^Needs confirmation: /, "")] : undefined;
        finish(errorResult(e, risky), "undo");
      }
    },
    [lastSaved, mode, base, finish],
  );

  const value = useMemo<EditContextValue>(
    () => ({
      blueprint: editing && draft ? draft : base,
      editing,
      pending: ops.length,
      error,
      busy,
      confirm,
      lastSaved,
      local: mode.kind === "local",
      start: () => {
        reset();
        setLastSaved(null);
        setEditing(true);
      },
      discard: () => {
        reset();
        setEditing(false);
      },
      push,
      save,
      undo,
      cancelConfirm: () => setConfirm(null),
      clearError: () => setError(null),
      dismissSaved: () => setLastSaved(null),
      adoptBlueprint: (bp: Blueprint) => {
        if (!editing) setBase(bp);
      },
      applyNow: async (list: Operation[], summary: string) => {
        const cs: ChangeSet = { baseVersion: base.version, source: "ui", summary, ops: list };
        if (mode.kind === "server") {
          const r = await saveBlueprintChanges(mode.businessId, cs, false);
          if (!r.ok) return r.needsConfirmation ? "That change needs your approval — ask the assistant." : r.error;
          setBase(r.blueprint);
          router.refresh();
          return null;
        }
        try {
          setBase(applyChangeSet(base, cs, {}).blueprint);
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : "Couldn’t change that";
        }
      },
    }),
    [editing, draft, base, ops.length, error, busy, confirm, lastSaved, mode, reset, push, save, undo, router],
  );

  return <EditContext.Provider value={value}>{children}</EditContext.Provider>;
}
