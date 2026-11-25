import type { Blueprint, Scheduling, WeeklyHours } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import type { OwnerBackend } from "@/agent/types";
import { addDays, isoDate, localToday, type LocalDate } from "@/engine/dates";
import { recordLabel } from "@/engine/blockData";
import { RecordError } from "@/engine/records";
import { findSlots, type FinderPractitioner, type FinderResource, type Interval, type Slot } from "./slots";
import { blocksTime, initialState, optionFor, stateOf } from "./lifecycle";
import { toE164 } from "@/whatsapp/core";

/**
 * Bookings on top of the blueprint's records: what can be booked, which times are free, and
 * making a booking. Works over any OwnerBackend (Supabase or in-memory).
 */

type Backend = Pick<OwnerBackend, "query" | "createRecord" | "updateRecord">;

export function schedulingOf(bp: Blueprint): Scheduling {
  if (!bp.scheduling) throw new RecordError("not_found", "Online booking isn’t set up for this business");
  return bp.scheduling;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

async function all(b: Pick<Backend, "query">, table: string, filters: Parameters<Backend["query"]>[0]["filters"] = []) {
  return (await b.query({ table, filters, limit: 500 })).records;
}

export interface CatalogService {
  id: string;
  name: string;
  durationMin: number;
  price: number | null;
  practitionerIds: string[] | null;
}
export interface Catalog {
  business: string;
  timezone: string;
  services: CatalogService[];
  practitioners: { id: string; name: string }[];
}

/** Services and people shown on the booking page (respecting the "online" checkboxes). */
export async function catalog(bp: Blueprint, b: Backend): Promise<Catalog> {
  const sc = schedulingOf(bp);
  const sTable = bp.tables.find((t) => t.id === sc.services.table)!;
  const pTable = bp.tables.find((t) => t.id === sc.practitioners.table)!;
  const online = (r: RecordRow, field?: string) => !field || r.data[field] === true;
  const services = (await all(b, sc.services.table))
    .filter((r) => online(r, sc.services.online) && num(r.data[sc.services.duration]) > 0)
    .map((r) => {
      const who = sc.services.practitioners ? r.data[sc.services.practitioners] : undefined;
      return {
        id: r.id,
        name: recordLabel(sTable, r),
        durationMin: num(r.data[sc.services.duration]),
        price: sc.services.price && typeof r.data[sc.services.price] === "number" ? (r.data[sc.services.price] as number) : null,
        practitionerIds: Array.isArray(who) && who.length ? (who as string[]) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const practitioners = (await all(b, sc.practitioners.table))
    .filter((r) => online(r, sc.practitioners.online))
    .map((r) => ({ id: r.id, name: recordLabel(pTable, r) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { business: bp.business.name, timezone: bp.business.timezone, services, practitioners };
}

/** Turns time-off values (date or datetime) into instants. Dates cover the whole local day. */
function toInterval(start: unknown, end: unknown): Interval | null {
  const s = str(start);
  const e = str(end);
  if (!s || !e) return null;
  const a = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
  const b = Date.parse(e.length === 10 ? `${e}T23:59:59Z` : e);
  return Number.isNaN(a) || Number.isNaN(b) || b <= a ? null : { start: a, end: b };
}

export interface SlotQuery {
  serviceId: string;
  practitionerId?: string;
  from?: LocalDate;
  days?: number;
}

/** Free slots for a service, from the business's live bookings, time off and hours. */
export async function availableSlots(bp: Blueprint, b: Backend, q: SlotQuery, now = new Date()): Promise<Slot[]> {
  const sc = schedulingOf(bp);
  const tz = bp.business.timezone;
  const from = q.from ?? localToday(now, tz);
  const days = Math.min(Math.max(q.days ?? 7, 1), 31);

  const services = await all(b, sc.services.table);
  const service = services.find((s) => s.id === q.serviceId);
  if (!service) throw new RecordError("not_found", "That service isn’t available");
  const svc = (r: RecordRow) => ({
    durationMin: num(r.data[sc.services.duration]),
    bufferBeforeMin: sc.services.bufferBefore ? num(r.data[sc.services.bufferBefore]) : 0,
    bufferAfterMin: sc.services.bufferAfter ? num(r.data[sc.services.bufferAfter]) : 0,
  });

  // Window to load: a day either side covers buffers and timezones.
  const windowStart = new Date(Date.UTC(from.year, from.month - 1, from.day - 1)).toISOString();
  const windowEnd = new Date(Date.UTC(from.year, from.month - 1, from.day + days + 1)).toISOString();
  const bookings = await all(b, sc.bookings.table, [
    { field: sc.bookings.start, op: "gte", value: windowStart },
    { field: sc.bookings.start, op: "lt", value: windowEnd },
  ]);
  const serviceById = new Map(services.map((s) => [s.id, svc(s)]));

  const busyByPractitioner = new Map<string, Interval[]>();
  const busyByResource = new Map<string, Interval[]>();
  const perDay = new Map<string, Record<string, number>>();
  const add = (m: Map<string, Interval[]>, k: string, i: Interval) => m.set(k, [...(m.get(k) ?? []), i]);
  for (const bk of bookings) {
    const state = stateOf(sc, bk.data[sc.bookings.status]);
    if (!blocksTime(state, sc.bookings.holdUntil ? str(bk.data[sc.bookings.holdUntil]) : null, now)) continue;
    const s = Date.parse(str(bk.data[sc.bookings.start]) ?? "");
    const e = Date.parse(str(bk.data[sc.bookings.end]) ?? "");
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    const buf = serviceById.get(str(bk.data[sc.bookings.service]) ?? "") ?? { bufferBeforeMin: 0, bufferAfterMin: 0 };
    const interval = { start: s - (buf.bufferBeforeMin ?? 0) * 60_000, end: e + (buf.bufferAfterMin ?? 0) * 60_000 };
    const who = str(bk.data[sc.bookings.practitioner]);
    if (who) {
      add(busyByPractitioner, who, interval);
      const day = isoDate(localToday(new Date(s), tz));
      const counts = perDay.get(who) ?? {};
      counts[day] = (counts[day] ?? 0) + 1;
      perDay.set(who, counts);
    }
    const res = sc.bookings.resource && str(bk.data[sc.bookings.resource]);
    if (res) add(busyByResource, res, interval);
  }
  if (sc.timeOff) {
    for (const off of await all(b, sc.timeOff.table)) {
      const who = str(off.data[sc.timeOff.who]);
      const i = toInterval(off.data[sc.timeOff.start], off.data[sc.timeOff.end]);
      if (who && i) add(busyByPractitioner, who, i);
    }
  }

  const pRows = await all(b, sc.practitioners.table);
  const practitioners: FinderPractitioner[] = pRows
    .filter((r) => !sc.practitioners.online || r.data[sc.practitioners.online] === true)
    .map((r) => ({
      id: r.id,
      hours: sc.practitioners.hours ? (r.data[sc.practitioners.hours] as WeeklyHours | undefined) ?? null : null,
      busy: busyByPractitioner.get(r.id) ?? [],
      maxPerDay: sc.practitioners.maxPerDay && typeof r.data[sc.practitioners.maxPerDay] === "number" ? (r.data[sc.practitioners.maxPerDay] as number) : null,
      bookingsPerDay: perDay.get(r.id) ?? {},
    }));

  let resources: FinderResource[] | null = null;
  if (sc.resources && sc.bookings.resource) {
    const rTable = bp.tables.find((t) => t.id === sc.resources!.table)!;
    const typeField = sc.resources.type ? rTable.fields.find((f) => f.id === sc.resources!.type) : undefined;
    resources = (await all(b, sc.resources.table)).map((r) => {
      const v = typeField ? r.data[typeField.id] : undefined;
      const type = typeField && "options" in typeField ? typeField.options.find((o) => o.id === v)?.label : undefined;
      return { id: r.id, type: type ?? null, busy: busyByResource.get(r.id) ?? [] };
    });
  }
  const sTable = bp.tables.find((t) => t.id === sc.services.table)!;
  const rtField = sc.services.resourceType ? sTable.fields.find((f) => f.id === sc.services.resourceType) : undefined;
  const rtValue = rtField ? service.data[rtField.id] : undefined;
  const resourceType = rtField && "options" in rtField ? (rtField.options.find((o) => o.id === rtValue)?.label ?? null) : null;
  const who = sc.services.practitioners ? service.data[sc.services.practitioners] : undefined;

  return findSlots({
    timezone: tz,
    now,
    from,
    days,
    businessHours: sc.hours,
    rules: sc.rules,
    service: { ...svc(service), practitionerIds: Array.isArray(who) && who.length ? (who as string[]) : null, resourceType },
    practitioners,
    resources,
    practitionerId: q.practitionerId,
  });
}

export interface BookingRequest {
  serviceId: string;
  practitionerId?: string;
  start: string;
  client: { name: string; email?: string; phone?: string };
  notes?: string;
}

/** Cancels holds whose time ran out, so their slots free up (also run by the worker). */
export async function expireHolds(bp: Blueprint, b: Backend, now = new Date()): Promise<number> {
  const sc = schedulingOf(bp);
  const held = sc.statuses.held;
  if (!held || !sc.bookings.holdUntil) return 0;
  const expired = await all(b, sc.bookings.table, [
    { field: sc.bookings.status, op: "eq", value: held },
    { field: sc.bookings.holdUntil, op: "lt", value: now.toISOString() },
  ]);
  for (const r of expired) await b.updateRecord(sc.bookings.table, r.id, { [sc.bookings.status]: optionFor(sc, "cancelled") });
  return expired.length;
}

/**
 * Books a slot: re-checks it is still free, finds or creates the client, creates the booking.
 * The database's overlap constraint is the final guard against two people taking the same time.
 */
export async function bookSlot(
  bp: Blueprint,
  b: Backend,
  req: BookingRequest,
  now = new Date(),
  opts: { holdUntil?: Date } = {},
): Promise<{ bookingId: string; slot: Slot; state: string; price: number | null }> {
  const sc = schedulingOf(bp);
  const name = req.client.name.trim();
  if (!name) throw new RecordError("invalid", "Please give your name");
  if (!req.client.email && !req.client.phone) throw new RecordError("invalid", "Please give an email or phone number so we can confirm");
  await expireHolds(bp, b, now);

  const day = localToday(new Date(req.start), bp.business.timezone);
  const slot = (await availableSlots(bp, b, { serviceId: req.serviceId, practitionerId: req.practitionerId, from: day, days: 1 }, now)).find(
    (s) => s.start === new Date(req.start).toISOString(),
  );
  if (!slot) throw new RecordError("invalid", "Sorry, that time is no longer available. Please pick another.");

  // Find the client by email, then phone (numbers compared normalised: "+1 604 555 0101" = "+16045550101"); otherwise add them.
  let clientId: string | undefined;
  if (sc.clients.email && req.client.email) {
    clientId = (await all(b, sc.clients.table, [{ field: sc.clients.email, op: "eq", value: req.client.email.trim().toLowerCase() }]))[0]?.id;
  }
  const phone = req.client.phone ? toE164(req.client.phone) : null;
  if (!clientId && sc.clients.phone && phone) {
    clientId = (await all(b, sc.clients.table, [{ field: sc.clients.phone, op: "not_empty" }])).find((r) => toE164(String(r.data[sc.clients.phone!])) === phone)?.id;
  }
  if (!clientId) {
    const values: Record<string, unknown> = { [sc.clients.name]: name };
    if (sc.clients.email && req.client.email) values[sc.clients.email] = req.client.email;
    if (sc.clients.phone && req.client.phone) values[sc.clients.phone] = req.client.phone;
    clientId = (await b.createRecord(sc.clients.table, values)).id;
  }

  // Held (e.g. awaiting a deposit) when asked and the setup supports it; else the normal start state.
  const hold = opts.holdUntil && sc.statuses.held && sc.bookings.holdUntil ? opts.holdUntil : undefined;
  const state = hold ? "held" : initialState(sc);
  const service = (await all(b, sc.services.table)).find((s) => s.id === req.serviceId);
  const price = sc.services.price && typeof service?.data[sc.services.price] === "number" ? (service.data[sc.services.price] as number) : null;
  const values: Record<string, unknown> = {
    [sc.bookings.start]: slot.start,
    [sc.bookings.end]: slot.end,
    [sc.bookings.service]: req.serviceId,
    [sc.bookings.practitioner]: slot.practitionerId,
    [sc.bookings.client]: clientId,
    [sc.bookings.status]: optionFor(sc, state),
  };
  if (sc.bookings.resource && slot.resourceId) values[sc.bookings.resource] = slot.resourceId;
  if (hold) values[sc.bookings.holdUntil!] = hold.toISOString();
  if (sc.bookings.amount && sc.services.price && typeof service?.data[sc.services.price] === "number") values[sc.bookings.amount] = service.data[sc.services.price];
  try {
    const created = await b.createRecord(sc.bookings.table, values);
    return { bookingId: created.id, slot, state, price };
  } catch (e) {
    if (e instanceof Error && /exclusion|overlap|conflicting/i.test(e.message)) {
      throw new RecordError("invalid", "Sorry, someone just booked that time. Please pick another.");
    }
    throw e;
  }
}

/** Days from `from` that have at least one slot (for a date picker), within the horizon. */
export async function daysWithSlots(bp: Blueprint, b: Backend, q: SlotQuery & { days: number }, now = new Date()) {
  const slots = await availableSlots(bp, b, q, now);
  const tz = bp.business.timezone;
  const out = new Map<string, number>();
  for (const s of slots) {
    const d = isoDate(localToday(new Date(s.start), tz));
    out.set(d, (out.get(d) ?? 0) + 1);
  }
  const start = q.from ?? localToday(now, tz);
  return Array.from({ length: q.days }, (_, i) => isoDate(addDays(start, i))).map((d) => ({ date: d, slots: out.get(d) ?? 0 }));
}

/**
 * Guard for rebooking nudges: does the client (of this booking, or this client record) already
 * have a future booking that still holds its time?
 */
export async function hasUpcomingBooking(
  bp: Blueprint,
  b: Pick<OwnerBackend, "query">,
  record: { tableId: string; recordId: string; data: Record<string, unknown> },
  now = new Date(),
): Promise<boolean> {
  const sc = bp.scheduling;
  if (!sc) return false;
  const clientId = record.tableId === sc.bookings.table ? str(record.data[sc.bookings.client]) : record.tableId === sc.clients.table ? record.recordId : undefined;
  if (!clientId) return false;
  const upcoming = await all(b, sc.bookings.table, [
    { field: sc.bookings.client, op: "eq", value: clientId },
    { field: sc.bookings.start, op: "gt", value: now.toISOString() },
  ]);
  return upcoming.some((r) => r.id !== record.recordId && blocksTime(stateOf(sc, r.data[sc.bookings.status]), sc.bookings.holdUntil ? str(r.data[sc.bookings.holdUntil]) : null, now));
}
