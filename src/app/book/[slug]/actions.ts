"use server";

import { availableSlots, bookSlot, catalog, daysWithSlots } from "@/booking/service";
import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { RecordError } from "@/engine/records";
import { publicBooking } from "@/server/bookingPage";

/** Public booking actions. "demo" is the sample salon in memory (nothing is saved). */

async function resolve(slug: string) {
  if (slug === "demo") return { blueprint: demoBlueprint, backend: memoryBackend({ blueprint: demoBlueprint, records: demoRecords() }).backend, demo: true };
  const r = await publicBooking(slug);
  return r ? { ...r, demo: false } : null;
}

const fail = (e: unknown) => ({ error: e instanceof RecordError ? e.message : "Something went wrong. Please try again." });

export async function loadCatalog(slug: string) {
  const r = await resolve(slug);
  return r ? catalog(r.blueprint, r.backend) : null;
}

export async function loadDays(slug: string, serviceId: string, practitionerId: string | null) {
  try {
    const r = await resolve(slug);
    if (!r) return fail(new RecordError("not_found", "Not found"));
    return { days: await daysWithSlots(r.blueprint, r.backend, { serviceId, practitionerId: practitionerId ?? undefined, days: 14 }) };
  } catch (e) {
    return fail(e);
  }
}

export async function loadSlots(slug: string, serviceId: string, practitionerId: string | null, date: string) {
  try {
    const r = await resolve(slug);
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(new RecordError("not_found", "Not found"));
    const [y, m, d] = date.split("-").map(Number);
    const slots = await availableSlots(r.blueprint, r.backend, { serviceId, practitionerId: practitionerId ?? undefined, from: { year: y, month: m, day: d }, days: 1 });
    return { slots };
  } catch (e) {
    return fail(e);
  }
}

export async function submitBooking(
  slug: string,
  req: { serviceId: string; practitionerId: string | null; start: string; name: string; email: string; phone: string; website?: string },
) {
  if (req.website) return { error: "Something went wrong. Please try again." }; // honeypot: bots fill hidden fields
  try {
    const r = await resolve(slug);
    if (!r) return fail(new RecordError("not_found", "Not found"));
    const booked = await bookSlot(r.blueprint, r.backend, {
      serviceId: req.serviceId,
      practitionerId: req.practitionerId ?? undefined,
      start: req.start,
      client: { name: req.name.slice(0, 100), email: req.email.trim() || undefined, phone: req.phone.trim() || undefined },
    });
    return { ok: true as const, start: booked.slot.start, practitionerId: booked.slot.practitionerId, confirmed: booked.state === "confirmed", demo: r.demo };
  } catch (e) {
    return fail(e);
  }
}
