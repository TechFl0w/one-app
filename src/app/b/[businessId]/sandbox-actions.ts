"use server";

import { createClient } from "@/lib/supabase/server";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "@/server/records";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";
import { getCurrentBlueprint } from "@/server/blueprints";
import { FILES_BUCKET, filePathFor, isBusinessFilePath, maxBytesFor, sizeLabel } from "@/lib/files";

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
export async function sandboxUpdate(businessId: string, table: string, id: string, data: Record<string, unknown>, confirmed = false) {
  return bridged(async () => {
    // Amount changes need confirmation (engine/risk.ts); `confirmed` is only sent by One App's own
    // dialog in the host page after the owner said yes, never by the screen's code.
    return view(await updateRecord(await createClient(), businessId, table, id, data, { confirmed: confirmed === true }));
  });
}
/** A screen's compiled code, for screens the page didn't render (Edit mode drafts). */
export async function sandboxComponent(businessId: string, componentId: string) {
  return bridged(async () => {
    const bp = await getCurrentBlueprint(await createClient(), businessId);
    const c = bp.components?.find((x) => x.id === componentId);
    if (!c) throw Object.assign(new Error("Screen not found"), { code: "not_found" });
    return { compiled: c.compiled, ...(c.css ? { css: c.css } : {}) };
  });
}

/** The host only calls this after the owner pressed Delete in One App's own dialog. */
export async function sandboxRemove(businessId: string, table: string, id: string) {
  return bridged(async () => {
    await deleteRecord(await createClient(), businessId, table, id, { confirmed: true });
  });
}

/**
 * Where the browser may upload one file for a file field: a one-time signed upload URL in this
 * business's folder. Storage policies check membership again when the upload happens.
 */
export async function sandboxUploadTarget(businessId: string, table: string, field: string, name: string, size: number, mime?: string) {
  return bridged(async () => {
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    const f = bp.tables.find((t) => t.id === table)?.fields.find((x) => x.id === field);
    if (!f || f.type !== "file") throw Object.assign(new Error("That isn’t a file field"), { code: "invalid" });
    const limit = maxBytesFor(typeof mime === "string" ? mime : undefined);
    if (!(size > 0) || size > limit) throw Object.assign(new Error(`Files like this can be up to ${sizeLabel(limit)}`), { code: "too_large" });
    const path = filePathFor(businessId, table, String(name ?? ""));
    const { data, error } = await supabase.storage.from(FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Couldn’t start the upload: ${error?.message ?? "no URL"}`);
    return { path, url: data.signedUrl };
  });
}

/** A short-lived link to view or download a file of this business. */
export async function sandboxFileUrl(businessId: string, path: string) {
  return bridged(async () => {
    if (typeof path !== "string" || !isBusinessFilePath(businessId, path)) throw Object.assign(new Error("Unknown file"), { code: "not_found" });
    const { data, error } = await (await createClient()).storage.from(FILES_BUCKET).createSignedUrl(path, 3600);
    if (error || !data) throw Object.assign(new Error("Couldn’t open the file"), { code: "not_found" });
    return data.signedUrl;
  });
}
