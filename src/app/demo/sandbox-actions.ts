"use server";

import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";

/** Demo data for generated components: reads the sample salon, validates writes, saves nothing. */
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }): SandboxRecord => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });
const fresh = () => memoryBackend({ blueprint: demoBlueprint, records: demoRecords() }).backend;

export async function demoSandboxList(q: unknown) {
  const r = await fresh().query(RecordQuery.parse(q));
  return { records: r.records.map(view), total: r.total };
}
export async function demoSandboxGet(table: string, id: string) {
  return view(await fresh().getRecord(table, id));
}
export async function demoSandboxCreate(table: string, data: Record<string, unknown>) {
  return view(await fresh().createRecord(table, data));
}
export async function demoSandboxUpdate(table: string, id: string, data: Record<string, unknown>) {
  return view(await fresh().updateRecord(table, id, data, { confirmed: true }));
}
export async function demoSandboxRemove(table: string, id: string) {
  await fresh().getRecord(table, id);
}
