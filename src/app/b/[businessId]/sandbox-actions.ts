"use server";

import { createClient } from "@/lib/supabase/server";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "@/server/records";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";
import { getCurrentBlueprint } from "@/server/blueprints";
import { createInvoiceFromQuote, documentUrl, ensureDocumentLink, sendDocument } from "@/server/documents";
import { documentFor, invoiceWork } from "@/engine/documents";
import { searchEverything } from "@/engine/search";
import { supabaseStore } from "@/server/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { availableSlots, bookSlot, type ExternalBusy } from "@/booking/service";
import { localLabel } from "@/engine/dates";
import type { Blueprint } from "@/schema/blueprint";
import { supabaseOwnerBackend } from "@/server/ownerBackend";
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

/** Quotes and invoices: send to the customer, get the customer link, invoice an accepted quote. */
export async function sandboxSendDocument(businessId: string, table: string, id: string) {
  return bridged(async () => sendDocument(await createClient(), businessId, table, id));
}
export async function sandboxDocumentLink(businessId: string, table: string, id: string) {
  return bridged(async () => {
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    const def = documentFor(bp, table);
    if (!def) throw new Error("This isn’t a quote or invoice.");
    await getRecord(supabase, businessId, table, id, bp); // the caller can see it
    return documentUrl(await ensureDocumentLink(createAdminClient(), businessId, def.id, id));
  });
}
export async function sandboxInvoiceFromQuote(businessId: string, table: string, id: string, depositPercent?: number) {
  return bridged(async () => createInvoiceFromQuote(await createClient(), businessId, table, id, { depositPercent: typeof depositPercent === "number" ? depositPercent : undefined }));
}

export async function sandboxInvoiceWork(businessId: string, table: string, client: string, from: string, to: string) {
  return bridged(async () => {
    if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("invalid: dates must look like 2026-11-01");
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    return invoiceWork(bp, supabaseOwnerBackend(supabase, businessId), table, client, { from, to });
  });
}

/** Free times and booking for screens (useFreeTimes / bookTime in the kit). */
async function freeTimesWith(bp: Blueprint, backend: Parameters<typeof availableSlots>[1] & { externalBusy?: ExternalBusy }, service: string, date: string, practitioner?: string, days = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid: date must look like 2026-11-27");
  const [y, m, d] = date.split("-").map(Number);
  const slots = await availableSlots(bp, backend, { serviceId: service, practitionerId: practitioner, from: { year: y, month: m, day: d }, days: Math.min(Math.max(days, 1), 7), externalBusy: backend.externalBusy });
  const tz = bp.business.timezone;
  return { timezone: tz, slots: slots.slice(0, 200).map((s) => ({ start: s.start, end: s.end, practitionerId: s.practitionerId, local: localLabel(s.start, tz) })) };
}
export async function sandboxFreeTimes(businessId: string, service: string, date: string, practitioner?: string, days?: number) {
  return bridged(async () => {
    const supabase = await createClient();
    return freeTimesWith(await getCurrentBlueprint(supabase, businessId), supabaseOwnerBackend(supabase, businessId), service, date, practitioner, days);
  });
}
export async function sandboxBookTime(businessId: string, service: string, start: string, client: { name: string; email?: string; phone?: string }, practitioner?: string) {
  return bridged(async () => {
    const supabase = await createClient();
    const r = await bookSlot(await getCurrentBlueprint(supabase, businessId), supabaseOwnerBackend(supabase, businessId), { serviceId: service, start, client, practitionerId: practitioner }, new Date(), { externalBusy: supabaseOwnerBackend(supabase, businessId).externalBusy });
    return { bookingId: r.bookingId, state: r.state };
  });
}

/** App-wide search (⌘K): a few matches from every table, as the signed-in member sees them. */
export async function sandboxSearch(businessId: string, q: string) {
  return bridged(async () => {
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    return searchEverything(bp, supabaseStore(supabase, businessId), String(q ?? ""));
  });
}
