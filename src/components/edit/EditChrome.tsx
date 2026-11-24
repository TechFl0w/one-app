"use client";

import { AlertTriangle, Pencil, Undo2, X } from "lucide-react";
import { Dialog } from "./Dialog";
import { useEdit } from "./EditProvider";

/** "Edit" button for page headers. */
export function EditButton() {
  const { editing, start } = useEdit();
  if (editing) return null;
  return (
    <button type="button" className="btn-ghost px-4 py-2" onClick={start}>
      <Pencil className="h-4 w-4" /> Edit
    </button>
  );
}

/** Sticky bar while editing: pending count, Discard, Done. Plus confirm dialog and toasts. */
export function EditChrome({ extra }: { extra?: React.ReactNode }) {
  const { editing, pending, busy, discard, save, error, clearError, confirm, cancelConfirm, undo, lastSaved, dismissSaved, local } = useEdit();

  return (
    <>
      {editing && (
        <div className="sticky top-0 z-20 -mx-4 -mt-6 mb-6 md:-mt-8 flex flex-wrap items-center gap-2 border-b border-line bg-card/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <span className="mr-auto text-sm font-semibold">
            Editing{" "}
            <span className="font-normal text-muted">
              · {pending === 0 ? "no changes yet" : `${pending} change${pending === 1 ? "" : "s"}`}
              {local && " · demo: kept in this browser"}
            </span>
          </span>
          {extra}
          <button type="button" className="btn-ghost px-4 py-2" onClick={discard} disabled={busy}>Discard</button>
          <button type="button" className="btn-primary px-5 py-2" onClick={() => save(false)} disabled={busy}>
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-3 rounded-2xl border border-red-200 bg-card p-4 text-sm shadow-soft">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <p className="flex-1 text-red-800">{error}</p>
          <button type="button" onClick={clearError} aria-label="Dismiss"><X className="h-4 w-4 text-muted" /></button>
        </div>
      )}

      {lastSaved && !editing && !error && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-card py-2 pl-5 pr-2 text-sm shadow-soft">
          <span className="min-w-0 flex-1 truncate">Saved · <span className="text-muted">{lastSaved.summary}</span></span>
          <button type="button" className="btn-ghost px-3 py-1.5" onClick={() => undo(false)} disabled={busy}>
            <Undo2 className="h-4 w-4" /> Undo
          </button>
          <button type="button" onClick={dismissSaved} className="rounded-full p-1.5 hover:bg-ground" aria-label="Dismiss"><X className="h-4 w-4 text-muted" /></button>
        </div>
      )}

      <Dialog open={!!confirm} onClose={cancelConfirm} title="Please confirm">
        <p className="mb-3 text-sm text-muted">
          {confirm?.purpose === "undo" ? "Undoing this will:" : "These changes can affect your data or automations:"}
        </p>
        <ul className="mb-6 list-disc space-y-1 pl-5 text-sm">
          {confirm?.items.map((i) => <li key={i}>{i}</li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={cancelConfirm}>Go back</button>
          <button type="button" className="btn-primary" onClick={() => (confirm?.purpose === "undo" ? undo(true) : save(true))} disabled={busy}>
            Yes, {confirm?.purpose === "undo" ? "undo" : "save"}
          </button>
        </div>
      </Dialog>
    </>
  );
}
