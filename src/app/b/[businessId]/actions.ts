"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/blocks/FormBlock";
import { createClient } from "@/lib/supabase/server";
import { commitChangeSet, getCurrentBlueprint, restorePage, undoHistoryEntry } from "@/server/blueprints";
import { ChangeSetError, previewChangeSet } from "@/engine/changeSet";
import { errorResult, okResult, type CommitResult } from "@/engine/commit";
import { riskyOps } from "@/engine/editing";
import { createRecord } from "@/server/records";
import { errorState, formFields, parseForm } from "@/server/forms";

/** Form block submit: create a record in `tableId`. Bound with businessId/tableId/blockFields. */
export async function submitRecordForm(
  businessId: string,
  tableId: string,
  wantedFields: string[] | undefined,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const supabase = await createClient();
    const blueprint = await getCurrentBlueprint(supabase, businessId);
    const parsed = parseForm(blueprint, tableId, formFields(blueprint, tableId, wantedFields), form);
    if (!parsed.ok) return parsed.state;
    await createRecord(supabase, businessId, tableId, parsed.input);
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: "Saved.", nonce: Date.now() };
  } catch (e) {
    return errorState(e);
  }
}

/** Edit mode "Done": saves the pending change set. Risky ops need `confirmed`. */
export async function saveBlueprintChanges(businessId: string, changeSet: unknown, confirmed: boolean): Promise<CommitResult> {
  try {
    const supabase = await createClient();
    const current = await getCurrentBlueprint(supabase, businessId);
    const preview = previewChangeSet(current, changeSet);
    if (!preview.ok) return errorResult(preview.error);
    if (preview.requiresConfirmation && !confirmed) {
      return errorResult(new ChangeSetError("needs_confirmation", "Needs confirmation"), riskyOps(preview));
    }
    const r = await commitChangeSet(supabase, businessId, changeSet, { confirmed });
    revalidatePath(`/b/${businessId}`, "layout");
    return okResult(r, { historyId: r.historyId });
  } catch (e) {
    return errorResult(e);
  }
}

export async function undoBlueprintChange(businessId: string, historyId: string, confirmed: boolean): Promise<CommitResult> {
  try {
    const r = await undoHistoryEntry(await createClient(), businessId, historyId, { confirmed });
    revalidatePath(`/b/${businessId}`, "layout");
    return okResult(r, { historyId: r.historyId });
  } catch (e) {
    return errorResult(e, e instanceof ChangeSetError && e.code === "needs_confirmation" ? [e.message.replace(/^Needs confirmation: /, "")] : undefined);
  }
}

/** Puts a page back to an earlier version (a normal change: it shows in Activity and can be undone). */
export async function restorePageVersion(businessId: string, pageId: string, version: number): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await restorePage(await createClient(), businessId, pageId, version);
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: r ? "Restored. You can undo this from Activity." : "The page already looks like that version." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t restore that version." };
  }
}

/** Undoes one earlier setup change from Activity (if it still fits the current setup). */
export async function undoSetupChange(businessId: string, historyId: string): Promise<{ ok: boolean; message: string }> {
  try {
    await undoHistoryEntry(await createClient(), businessId, historyId, { confirmed: true });
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: "Undone." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t undo that change." };
  }
}
