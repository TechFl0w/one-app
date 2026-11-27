"use client";

import { createContext, useContext } from "react";
import type { Blueprint } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";
import type { UndoToken } from "@/engine/commit";

/** The Edit-mode context (kept apart from EditProvider so forms can use it without server code). */
export interface Confirm {
  purpose: "save" | "undo";
  items: string[];
}

export interface EditContextValue {
  /** What to render: the draft while editing, else the saved blueprint. */
  blueprint: Blueprint;
  editing: boolean;
  pending: number;
  error: string | null;
  busy: boolean;
  confirm: Confirm | null;
  lastSaved: { summary: string; undo: UndoToken } | null;
  local: boolean;
  start(): void;
  discard(): void;
  /** Adds ops to the pending change set. Returns false (and sets `error`) if they don't apply. */
  push(ops: Operation | Operation[]): boolean;
  save(confirmed?: boolean): void;
  undo(confirmed?: boolean): void;
  cancelConfirm(): void;
  clearError(): void;
  dismissSaved(): void;
  /** Take a blueprint changed elsewhere (demo assistant). Ignored while editing. */
  adoptBlueprint(bp: Blueprint): void;
  /**
   * Saves a small, safe setup change right away (a new choice, a new field) — outside Edit mode.
   * Returns an error message when it couldn't be saved (or would need approval).
   */
  applyNow(ops: Operation[], summary: string): Promise<string | null>;
}

/** The edit context when there is one (forms also open outside the app shell). */
export function useEditOptional(): EditContextValue | null {
  return useContext(EditContext);
}

export const EditContext = createContext<EditContextValue | null>(null);

export function useEdit(): EditContextValue {
  const v = useContext(EditContext);
  if (!v) throw new Error("useEdit must be used inside <EditProvider>");
  return v;
}

