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
  category?: string;
  description?: string;
  /** Storage path of the service's photo (the page signs it). */
  photo?: string;
  /** Duration and price by kind (a dog's size), keyed by the kind's option id. */
  variants?: Record<string, { durationMin: number; price: number | null }>;
}
export interface CatalogField {
  id: string;
  label: string;
  type: string;
  options?: { id: string; label: string }[];
}
export interface Catalog {
  business: string;
  timezone: string;
  services: CatalogService[];
  practitioners: { id: string; name: string; photo?: string }[];
  /** Bookings for a pet, car or child: what to call one, its kinds, and what to ask about a new one. */
  for?: { label: string; kinds: { id: string; label: string }[] | null; ask: CatalogField[] };
  /** What must be true before booking, with the field the client fills in (files are brought along). */
  requirements?: { label: string; on: "for" | "client"; rule: string; field: CatalogField }[];
}

const fieldMeta = (t: { fields: Blueprint["tables"][number]["fields"] } | undefined, id: string): CatalogField | undefined => {
  const f = t?.fields.find((x) => x.id === id);
  return f ? { id: f.id, label: f.label, type: f.type, ...("options" in f ? { options: f.options.map((o) => ({ id: o.id, label: o.label })) } : {}) } : undefined;
};
const firstPath = (v: unknown): string | undefined => {
  const one = Array.isArray(v) ? v[0] : v;
  return one && typeof one === "object" && typeof (one as { path?: unknown }).path === "string" ? (one as { path: string }).path : undefined;
};

/** The kind options (a dog's size) on the "for" table. */
function kindsOf(bp: Blueprint, sc: Scheduling) {
  const f = sc.for?.kind ? bp.tables.find((t) => t.id === sc.for!.table)?.fields.find((x) => x.id === sc.for!.kind) : undefined;
  return f && "options" in f ? f.options : null;
}

/** Variants by service, keyed by the for-kind option id (matched to the variant's kind by id or label). */
async function variantsBy(bp: Blueprint, sc: Scheduling, b: Pick<Backend, "query">) {
  const out = new Map<string, Record<string, { durationMin: number; price: number | null }>>();
  const v = sc.variants;
  const kinds = kindsOf(bp, sc);
  if (!v || !kinds) return out;
  const vf = bp.tables.find((t) => t.id === v.table)?.fields.find((f) => f.id === v.kind);
  const vOpts = vf && "options" in vf ? vf.options : [];
  for (const r of await all(b, v.table)) {
    const svc = str(r.data[v.service]) ?? (Array.isArray(r.data[v.service]) ? String((r.data[v.service] as unknown[])[0]) : undefined);
    const raw = str(r.data[v.kind]);
    const label = vOpts.find((o) => o.id === raw)?.label ?? raw;
    const kind = kinds.find((k) => k.id === raw || k.label.toLowerCase() === label?.toLowerCase());
    const dur = num(r.data[v.duration]);
    if (!svc || !kind || dur <= 0) continue;
    const price = v.price && typeof r.data[v.price] === "number" ? (r.data[v.price] as number) : null;
    out.set(svc, { ...(out.get(svc) ?? {}), [kind.id]: { durationMin: dur, price } });
  }
  return out;
}

/** Services and people shown on the booking page (respecting the "online" checkboxes). */
export async function catalog(bp: Blueprint, b: Backend): Promise<Catalog> {
  const sc = schedulingOf(bp);
  const sTable = bp.tables.find((t) => t.id === sc.services.table)!;
  const pTable = bp.tables.find((t) => t.id === sc.practitioners.table)!;
  const online = (r: RecordRow, field?: string) => !field || r.data[field] === true;
  const variants = await variantsBy(bp, sc, b);
  const catField = sc.services.category ? sTable.fields.find((f) => f.id === sc.services.category) : undefined;
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
        ...(catField && "options" in catField && catField.options.find((o) => o.id === r.data[catField.id]) ? { category: catField.options.find((o) => o.id === r.data[catField.id])!.label } : {}),
        ...(sc.services.description && str(r.data[sc.services.description]) ? { description: str(r.data[sc.services.description])!.slice(0, 300) } : {}),
        ...(sc.services.photo && firstPath(r.data[sc.services.photo]) ? { photo: firstPath(r.data[sc.services.photo]) } : {}),
        ...(variants.get(r.id) ? { variants: variants.get(r.id) } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const practitioners = (await all(b, sc.practitioners.table))
    .filter((r) => online(r, sc.practitioners.online))
    .map((r) => ({ id: r.id, name: recordLabel(pTable, r), ...(sc.practitioners.photo && firstPath(r.data[sc.practitioners.photo]) ? { photo: firstPath(r.data[sc.practitioners.photo]) } : {}) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fTable = sc.for ? bp.tables.find((t) => t.id === sc.for!.table) : undefined;
  const cTable = bp.tables.find((t) => t.id === sc.clients.table);
  const reqs = (sc.requirements ?? []).flatMap((r) => {
    const field = fieldMeta(r.on === "for" ? fTable : cTable, r.field);
    return field ? [{ label: r.label, on: r.on, rule: r.rule, field }] : [];
  });
  return {
    business: bp.business.name,
    timezone: bp.business.timezone,
    services,
    practitioners,
    ...(sc.for && fTable
      ? { for: { label: sc.for.label ?? singularOf(fTable.label), kinds: kindsOf(bp, sc)?.map((o) => ({ id: o.id, label: o.label })) ?? null, ask: (sc.for.ask ?? []).map((id) => fieldMeta(fTable, id)).filter((x): x is CatalogField => !!x) } }
      : {}),
    ...(reqs.length ? { requirements: reqs } : {}),
  };
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

const singularOf = (s: string) => s.replace(/ies$/i, "y").replace(/(?<!s)s$/i, "").toLowerCase();

export interface SlotQuery {
  serviceId: string;
  practitionerId?: string;
  /** The kind (a dog's size, option id of for.kind): picks the service's variant. */
  kind?: string;
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

  const variant = q.kind ? (await variantsBy(bp, sc, b)).get(service.id)?.[q.kind] : undefined;

  return findSlots({
    timezone: tz,
    now,
    from,
    days,
    businessHours: sc.hours,
    rules: sc.rules,
    service: { ...svc(service), ...(variant ? { durationMin: variant.durationMin } : {}), practitionerIds: Array.isArray(who) && who.length ? (who as string[]) : null, resourceType },
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
  /** The kind (a dog's size): picks the service variant. */
  kind?: string;
  /** Who/what it's for (a pet by name), with answers to the page's questions. */
  for?: { name: string; values?: Record<string, unknown> };
  /** Answers about the client (requirements on the client, e.g. a waiver). */
  clientValues?: Record<string, unknown>;
  /** Uploaded documents are accepted only from this business's own storage folder. */
  filesIn?: string;
}

/** Keeps only values for fields the booking page asked about, in a type each field accepts. */
function asked(values: Record<string, unknown> | undefined, allowed: CatalogField[], filesIn?: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of allowed) {
    const v = values?.[f.id];
    if (v === undefined || v === null || v === "") continue;
    if (f.type === "checkbox") out[f.id] = v === true || v === "on" || v === "true";
    else if (f.type === "number") { const n = Number(v); if (Number.isFinite(n)) out[f.id] = n; }
    else if (f.type === "date") { if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.id] = v; }
    else if (f.type === "choice" || f.type === "status") { if (f.options?.some((o) => o.id === v)) out[f.id] = v; }
    else if (f.type === "file") {
      // An uploaded document: a path in this business's folder (businessId/table/id/name).
      const file = typeof v === "string" ? (() => { try { return JSON.parse(v) as unknown; } catch { return null; } })() : v;
      const p = file && typeof file === "object" ? (file as { path?: unknown; name?: unknown }) : null;
      if (filesIn && p && typeof p.path === "string" && p.path.split("/")[0] === filesIn && p.path.split("/").length === 4 && !p.path.includes("..")) out[f.id] = { path: p.path, name: String(p.name ?? "document").slice(0, 255) };
    } else out[f.id] = String(v).slice(0, 1000);
  }
  return out;
}

/** What's still missing for a booking on `day` (YYYY-MM-DD); files are brought along, not checked. */
export function missingRequirements(reqs: NonNullable<Catalog["requirements"]>, forData: Record<string, unknown>, clientData: Record<string, unknown>, day: string): string[] {
  return reqs
    // Documents can also be brought on the day: only typed answers block a booking.
    .filter((r) => r.field.type !== "file")
    .filter((r) => {
      const v = (r.on === "for" ? forData : clientData)[r.field.id];
      if (r.rule === "checked") return v !== true;
      if (r.rule === "valid_on_date") return !(typeof v === "string" && v.slice(0, 10) >= day);
      return v === undefined || v === null || v === "";
    })
    .map((r) => r.label);
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
  const slot = (await availableSlots(bp, b, { serviceId: req.serviceId, practitionerId: req.practitionerId, kind: req.kind, from: day, days: 1 }, now)).find(
    (s) => s.start === new Date(req.start).toISOString(),
  );
  if (!slot) throw new RecordError("invalid", "Sorry, that time is no longer available. Please pick another.");

  // Find the client by email, then phone (numbers compared normalised: "+1 604 555 0101" = "+16045550101").
  let clientId: string | undefined;
  if (sc.clients.email && req.client.email) {
    clientId = (await all(b, sc.clients.table, [{ field: sc.clients.email, op: "eq", value: req.client.email.trim().toLowerCase() }]))[0]?.id;
  }
  const phone = req.client.phone ? toE164(req.client.phone) : null;
  let clientRow: RecordRow | undefined;
  if (!clientId && sc.clients.phone && phone) {
    clientRow = (await all(b, sc.clients.table, [{ field: sc.clients.phone, op: "not_empty" }])).find((r) => toE164(String(r.data[sc.clients.phone!])) === phone);
    clientId = clientRow?.id;
  }
  if (clientId && !clientRow) clientRow = (await all(b, sc.clients.table)).find((r) => r.id === clientId);

  // What it's for (a pet): the client's own by name, else a new one under them.
  const cat = sc.for || sc.requirements?.length ? await catalog(bp, b) : null;
  const reqs = cat?.requirements ?? [];
  const forFields = [...(cat?.for?.ask ?? []), ...reqs.filter((r) => r.on === "for").map((r) => r.field)];
  const clientFields = reqs.filter((r) => r.on === "client").map((r) => r.field);
  let forRow: RecordRow | undefined;
  const forName = req.for?.name.trim();
  if (sc.for) {
    if (!forName) throw new RecordError("invalid", `Please give your ${cat?.for?.label ?? "pet"}’s name`);
    if (clientId) forRow = (await all(b, sc.for.table, [{ field: sc.for.client, op: "eq", value: clientId }])).find((r) => String(r.data[sc.for!.name] ?? "").trim().toLowerCase() === forName.toLowerCase());
  }
  const forValues = { ...asked(req.for?.values, forFields, req.filesIn), ...(sc.for?.kind && req.kind && cat?.for?.kinds?.some((k) => k.id === req.kind) ? { [sc.for.kind]: req.kind } : {}) };
  const clientValues = asked(req.clientValues, clientFields, req.filesIn);
  const missing = missingRequirements(reqs, { ...(forRow?.data ?? {}), ...forValues }, { ...(clientRow?.data ?? {}), ...clientValues }, isoDate(day));
  if (missing.length) throw new RecordError("invalid", `Before we can book: ${missing.join("; ")}.`);

  if (!clientId) {
    const values: Record<string, unknown> = { [sc.clients.name]: name, ...clientValues };
    if (sc.clients.email && req.client.email) values[sc.clients.email] = req.client.email;
    if (sc.clients.phone && req.client.phone) values[sc.clients.phone] = req.client.phone;
    clientId = (await b.createRecord(sc.clients.table, values)).id;
  } else if (Object.keys(clientValues).length) await b.updateRecord(sc.clients.table, clientId, clientValues);
  let forId: string | undefined;
  if (sc.for && forName) {
    if (forRow) {
      forId = forRow.id;
      if (Object.keys(forValues).length) await b.updateRecord(sc.for.table, forRow.id, forValues);
    } else forId = (await b.createRecord(sc.for.table, { [sc.for.name]: forName, [sc.for.client]: clientId, ...forValues })).id;
  }

  // Held (e.g. awaiting a deposit) when asked and the setup supports it; else the normal start state.
  const hold = opts.holdUntil && sc.statuses.held && sc.bookings.holdUntil ? opts.holdUntil : undefined;
  const state = hold ? "held" : initialState(sc);
  const service = (await all(b, sc.services.table)).find((s) => s.id === req.serviceId);
  const variant = req.kind ? (await variantsBy(bp, sc, b)).get(req.serviceId)?.[req.kind] : undefined;
  const price = variant?.price ?? (sc.services.price && typeof service?.data[sc.services.price] === "number" ? (service.data[sc.services.price] as number) : null);
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
  if (sc.bookings.amount && price != null) values[sc.bookings.amount] = price;
  if (sc.for && forId) values[sc.for.booking] = forId;
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
