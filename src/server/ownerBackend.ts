import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnerBackend } from "@/agent/types";
import { ChangeSetError, previewChangeSet } from "@/engine/changeSet";
import { errorResult, okResult } from "@/engine/commit";
import { riskyOps } from "@/engine/editing";
import { commitChangeSet, getCurrentBlueprint } from "./blueprints";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "./records";

/** OwnerBackend for a real business, acting as the signed-in user (RLS applies to every call). */
export function supabaseOwnerBackend(supabase: SupabaseClient, businessId: string): OwnerBackend {
  return {
    blueprint: () => getCurrentBlueprint(supabase, businessId),
    query: (q) => listRecords(supabase, businessId, q),
    getRecord: (t, id) => getRecord(supabase, businessId, t, id),
    createRecord: (t, input) => createRecord(supabase, businessId, t, input),
    updateRecord: (t, id, input) => updateRecord(supabase, businessId, t, id, input),
    deleteRecord: (t, id) => deleteRecord(supabase, businessId, t, id, { confirmed: true }),
    async commitChangeSet(cs, confirmed) {
      try {
        const current = await getCurrentBlueprint(supabase, businessId);
        const p = previewChangeSet(current, cs);
        if (p.ok && p.requiresConfirmation && !confirmed) {
          return errorResult(new ChangeSetError("needs_confirmation", "Needs confirmation"), riskyOps(p));
        }
        const r = await commitChangeSet(supabase, businessId, cs, { confirmed });
        return okResult(r, { historyId: r.historyId });
      } catch (e) {
        return errorResult(e);
      }
    },
  };
}
