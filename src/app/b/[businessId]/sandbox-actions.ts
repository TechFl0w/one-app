"use server";

import { createClient } from "@/lib/supabase/server";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "@/server/records";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";

/**
 * Data access for generated components (via the frame host). Runs as the signed-in user, so RLS
 * and record validation apply exactly as in the rest of the app; writes are audited as "ui".
 */
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }): SandboxRecord => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });

export async function sandboxList(businessId: string, q: unknown) {
  return bridged(async () => {
    const r = await listRecords(await createClient(), businessId, RecordQuery.parse(q));
    return { records: r.records.map(view), total: r.total };
  });
}
export async function sandboxGet(businessId: string, table: string, id: string) {
  return bridged(async () => {
    return view(await getRecord(await createClient(), businessId, table, id));
  });
}
export async function sandboxCreate(businessId: string, table: string, data: Record<string, unknown>) {
  return bridged(async () => {
    return view(await createRecord(await createClient(), businessId, table, data));
  });
}
export async function sandboxUpdate(businessId: string, table: string, id: string, data: Record<string, unknown>) {
  return bridged(async () => {
    // Price changes etc. still need confirmation (engine/risk.ts); generated UI can't confirm them.
    return view(await updateRecord(await createClient(), businessId, table, id, data));
  });
}
/** The host only calls this after the owner pressed Delete in One App's own dialog. */
export async function sandboxRemove(businessId: string, table: string, id: string) {
  return bridged(async () => {
    await deleteRecord(await createClient(), businessId, table, id, { confirmed: true });
  });
}
