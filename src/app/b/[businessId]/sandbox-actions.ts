"use server";

import { createClient } from "@/lib/supabase/server";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "@/server/records";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";

/**
 * Data access for generated components (via the frame host). Runs as the signed-in user, so RLS
 * and record validation apply exactly as in the rest of the app; writes are audited as "ui".
 */
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }): SandboxRecord => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });
const friendly = (e: unknown) => new Error(e instanceof Error ? e.message : "Something went wrong");

export async function sandboxList(businessId: string, q: unknown) {
  try {
    const r = await listRecords(await createClient(), businessId, RecordQuery.parse(q));
    return { records: r.records.map(view), total: r.total };
  } catch (e) {
    throw friendly(e);
  }
}
export async function sandboxGet(businessId: string, table: string, id: string) {
  try {
    return view(await getRecord(await createClient(), businessId, table, id));
  } catch (e) {
    throw friendly(e);
  }
}
export async function sandboxCreate(businessId: string, table: string, data: Record<string, unknown>) {
  try {
    return view(await createRecord(await createClient(), businessId, table, data));
  } catch (e) {
    throw friendly(e);
  }
}
export async function sandboxUpdate(businessId: string, table: string, id: string, data: Record<string, unknown>) {
  try {
    // Price changes etc. still need confirmation (engine/risk.ts); generated UI can't confirm them.
    return view(await updateRecord(await createClient(), businessId, table, id, data));
  } catch (e) {
    throw friendly(e);
  }
}
/** The host only calls this after the owner pressed Delete in One App's own dialog. */
export async function sandboxRemove(businessId: string, table: string, id: string) {
  try {
    await deleteRecord(await createClient(), businessId, table, id, { confirmed: true });
  } catch (e) {
    throw friendly(e);
  }
}
