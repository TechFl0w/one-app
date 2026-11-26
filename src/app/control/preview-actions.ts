"use server";

import { memoryBackend } from "@/agent/memoryBackend";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";
import { previewApp } from "@/server/preview";

/** Data for previews: the app's sample records; writes are checked but never saved. */
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }): SandboxRecord => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });
const backend = async (businessId: string) => memoryBackend(await previewApp(businessId)).backend;

export async function previewList(businessId: string, q: unknown) {
  return bridged(async () => {
    const r = await (await backend(businessId)).query(RecordQuery.parse(q));
    return { records: r.records.map(view), total: r.total };
  });
}
export async function previewGet(businessId: string, table: string, id: string) {
  return bridged(async () => view(await (await backend(businessId)).getRecord(table, id)));
}
export async function previewCreate(businessId: string, table: string, data: Record<string, unknown>) {
  return bridged(async () => view(await (await backend(businessId)).createRecord(table, data)));
}
export async function previewUpdate(businessId: string, table: string, id: string, data: Record<string, unknown>) {
  return bridged(async () => view(await (await backend(businessId)).updateRecord(table, id, data, { confirmed: true })));
}
export async function previewRemove(businessId: string, table: string, id: string) {
  return bridged(async () => {
    await (await backend(businessId)).getRecord(table, id);
  });
}
