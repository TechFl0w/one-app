import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blueprint } from "@/schema/blueprint";
import { RecordId, type RecordQuery, type RecordRow } from "@/schema/records";
import {
  buildRecordQuery,
  linkedIds,
  projectData,
  RecordError,
  assertFilesInBusiness,
  tableOrThrow,
  validateRecordInput,
} from "@/engine/records";
import { getCurrentBlueprint } from "./blueprints";
import { addComputed, loadAllVia, queryWithComputed } from "@/engine/computed";
import { supabaseStore } from "./store";
import { recordUpdateIsRisky } from "@/engine/risk";

/**
 * Records CRUD that respects the blueprint. Every call takes a Supabase client acting as the
 * signed-in user, so RLS limits it to that user's businesses. These are the functions the
 * owner agent's tools will call.
 */

type Row = { id: string; table_id?: string; data: Record<string, unknown>; created_at: string; updated_at: string };

const toView = (bp: Blueprint, tableId: string, r: Row): RecordRow => ({
  id: r.id,
  tableId,
  data: projectData(tableOrThrow(bp, tableId), r.data ?? {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function checkId(id: string) {
  if (!RecordId.safeParse(id).success) throw new RecordError("not_found", "Record not found");
}

export async function listRecords(
  supabase: SupabaseClient,
  businessId: string,
  query: RecordQuery,
  blueprint?: Blueprint,
): Promise<{ records: RecordRow[]; total: number }> {
  const bp = blueprint ?? (await getCurrentBlueprint(supabase, businessId));
  // Filters/sorts on computed fields (derived statuses, rollups) run after computing.
  return queryWithComputed(bp, query, async (q) => {
    const params = buildRecordQuery(bp, q);
    const { data, error } = await supabase.rpc("query_records", { p_business_id: businessId, ...params });
    if (error) throw new Error(`Could not load records: ${error.message}`);
    const rows = (data ?? []) as (Row & { total: number })[];
    return { records: rows.map((r) => toView(bp, params.p_table_id, r)), total: rows.length ? Number(rows[0].total) : 0 };
  }, loadAllVia(supabaseStore(supabase, businessId), bp));
}

export async function getRecord(
  supabase: SupabaseClient,
  businessId: string,
  tableId: string,
  recordId: string,
  blueprint?: Blueprint,
): Promise<RecordRow> {
  checkId(recordId);
  const bp = blueprint ?? (await getCurrentBlueprint(supabase, businessId));
  tableOrThrow(bp, tableId);
  const { data, error } = await supabase
    .from("records")
    .select("id, data, created_at, updated_at")
    .eq("business_id", businessId)
    .eq("table_id", tableId)
    .eq("id", recordId)
    .maybeSingle();
  if (error) throw new Error(`Could not load record: ${error.message}`);
  if (!data) throw new RecordError("not_found", "Record not found");
  const [one] = await addComputed(bp, tableId, [toView(bp, tableId, data as Row)], loadAllVia(supabaseStore(supabase, businessId), bp));
  return one;
}

export async function createRecord(
  supabase: SupabaseClient,
  businessId: string,
  tableId: string,
  input: unknown,
): Promise<RecordRow> {
  const bp = await getCurrentBlueprint(supabase, businessId);
  const table = tableOrThrow(bp, tableId);
  const data = validateRecordInput(table, input, "create");
  assertFilesInBusiness(table, data, businessId);
  await assertLinksExist(supabase, businessId, linkedIds(table, data));
  const { data: row, error } = await supabase
    .from("records")
    .insert({ business_id: businessId, table_id: tableId, data })
    .select("id, data, created_at, updated_at")
    .single();
  if (error) throw new Error(`Could not save record: ${error.message}`);
  // With computed values, so callers (screens, the assistant) see the status the record now has.
  const [view] = await addComputed(bp, tableId, [toView(bp, tableId, row as Row)], loadAllVia(supabaseStore(supabase, businessId), bp));
  return view;
}

/** Merges the given fields into the record; `null` clears a field. */
export async function updateRecord(
  supabase: SupabaseClient,
  businessId: string,
  tableId: string,
  recordId: string,
  input: unknown,
  opts: { confirmed?: boolean } = {},
): Promise<RecordRow> {
  checkId(recordId);
  const bp = await getCurrentBlueprint(supabase, businessId);
  const table = tableOrThrow(bp, tableId);
  const patch = validateRecordInput(table, input, "update");
  if (recordUpdateIsRisky(table, patch) && !opts.confirmed) {
    throw new RecordError("needs_confirmation", "Changing a price or amount needs confirmation");
  }
  assertFilesInBusiness(table, patch, businessId);
  await assertLinksExist(supabase, businessId, linkedIds(table, patch));
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
  const unset = Object.keys(patch).filter((k) => patch[k] === null);
  const { data: rows, error } = await supabase.rpc("patch_record", {
    p_business_id: businessId,
    p_table_id: tableId,
    p_record_id: recordId,
    p_set: set,
    p_unset: unset,
  });
  const row = (rows as Row[] | null)?.[0];
  if (error) throw new Error(`Could not save record: ${error.message}`);
  if (!row) throw new RecordError("not_found", "Record not found");
  // With computed values, so callers (screens, the assistant) see the status the record now has.
  const [view] = await addComputed(bp, tableId, [toView(bp, tableId, row as Row)], loadAllVia(supabaseStore(supabase, businessId), bp));
  return view;
}

/** Deleting data is risky (CLAUDE.md rule 5): requires `confirmed`. Owners/admins only (RLS). */
export async function deleteRecord(
  supabase: SupabaseClient,
  businessId: string,
  tableId: string,
  recordId: string,
  opts: { confirmed?: boolean } = {},
): Promise<void> {
  checkId(recordId);
  if (!opts.confirmed) throw new RecordError("needs_confirmation", "Deleting a record needs confirmation");
  const { data, error } = await supabase
    .from("records")
    .delete()
    .eq("business_id", businessId)
    .eq("table_id", tableId)
    .eq("id", recordId)
    .select("id");
  if (error) throw new Error(`Could not delete record: ${error.message}`);
  if (!data?.length) throw new RecordError("not_found", "Record not found or you are not allowed to delete it");
}

async function assertLinksExist(supabase: SupabaseClient, businessId: string, byTable: Map<string, Set<string>>) {
  for (const [tableId, ids] of byTable) {
    const { data, error } = await supabase
      .from("records")
      .select("id")
      .eq("business_id", businessId)
      .eq("table_id", tableId)
      .in("id", [...ids]);
    if (error) throw new Error(`Could not check linked records: ${error.message}`);
    const found = new Set((data ?? []).map((r) => r.id as string));
    const missing = [...ids].filter((id) => !found.has(id));
    if (missing.length) {
      throw new RecordError("invalid", `Linked record not found: ${missing.join(", ")}`, [
        { field: tableId, message: "Linked record not found" },
      ]);
    }
  }
}
