"use server";

import { memoryBackend } from "@/agent/memoryBackend";
import { currentDemo } from "@/demo/current";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";

/** Demo data for generated components: reads the sample salon, validates writes, saves nothing. */
const view = (r: { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }): SandboxRecord => ({ id: r.id, data: r.data, createdAt: r.createdAt, updatedAt: r.updatedAt });
const fresh = async () => {
  const { blueprint, records } = await currentDemo();
  return memoryBackend({ blueprint, records }).backend;
};

export async function demoSandboxList(q: unknown) {
  return bridged(async () => {
    const r = await (await fresh()).query(RecordQuery.parse(q));
    return { records: r.records.map(view), total: r.total };
  });
}
export async function demoSandboxGet(table: string, id: string) {
  return bridged(async () => {
    return view(await (await fresh()).getRecord(table, id));
  });
}
export async function demoSandboxCreate(table: string, data: Record<string, unknown>) {
  return bridged(async () => {
    return view(await (await fresh()).createRecord(table, data));
  });
}
export async function demoSandboxUpdate(table: string, id: string, data: Record<string, unknown>) {
  return bridged(async () => {
    return view(await (await fresh()).updateRecord(table, id, data, { confirmed: true }));
  });
}
export async function demoSandboxRemove(table: string, id: string) {
  return bridged(async () => {
    await (await fresh()).getRecord(table, id);
  });
}
