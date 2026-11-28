"use server";

import { memoryBackend } from "@/agent/memoryBackend";
import { currentDemo } from "@/demo/current";
import { RecordQuery } from "@/schema/records";
import type { SandboxRecord } from "@/sandbox/protocol";
import { bridged } from "@/sandbox/result";
import { availableSlots, bookSlot } from "@/booking/service";
import { localLabel } from "@/engine/dates";
import type { Blueprint } from "@/schema/blueprint";
import { searchEverything } from "@/engine/search";
import { memoryStore } from "@/engine/store";

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

/** Free times and booking for screens (useFreeTimes / bookTime in the kit). */
async function freeTimesWith(bp: Blueprint, backend: Parameters<typeof availableSlots>[1], service: string, date: string, practitioner?: string, days = 1) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid: date must look like 2026-11-27");
  const [y, m, d] = date.split("-").map(Number);
  const slots = await availableSlots(bp, backend, { serviceId: service, practitionerId: practitioner, from: { year: y, month: m, day: d }, days: Math.min(Math.max(days, 1), 7) });
  const tz = bp.business.timezone;
  return { timezone: tz, slots: slots.slice(0, 200).map((s) => ({ start: s.start, end: s.end, practitionerId: s.practitionerId, local: localLabel(s.start, tz) })) };
}
export async function demoFreeTimes(service: string, date: string, practitioner?: string, days?: number) {
  return bridged(async () => {
    const { blueprint, records } = await currentDemo();
    return freeTimesWith(blueprint, memoryBackend({ blueprint, records }).backend, service, date, practitioner, days);
  });
}
export async function demoBookTime(service: string, start: string, client: { name: string; email?: string; phone?: string }, practitioner?: string) {
  return bridged(async () => {
    const { blueprint, records } = await currentDemo();
    const r = await bookSlot(blueprint, memoryBackend({ blueprint, records }).backend, { serviceId: service, start, client, practitionerId: practitioner });
    return { bookingId: r.bookingId, state: r.state }; // the demo doesn't keep it
  });
}

export async function demoSearch(q: string) {
  return bridged(async () => {
    const { blueprint, records } = await currentDemo();
    return searchEverything(blueprint, memoryStore(records), String(q ?? ""));
  });
}
