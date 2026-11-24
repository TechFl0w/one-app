import { WEEKDAYS, type WeeklyHours } from "@/schema/blueprint";
import { addDays, isoDate, localDateTimeToIso, type LocalDate } from "@/engine/dates";

/**
 * The slot finder. Pure and deterministic: same input, same slots. Everything is computed on the
 * business's wall clock (opening hours, steps) and converted to instants per day, so DST days
 * get the right UTC times. See docs/booking-engine.md.
 *
 * A slot is free when the practitioner works then, the appointment plus its buffers doesn't touch
 * anything they're busy with, a matching resource is free, and the rules allow it (notice,
 * horizon, daily max). With "any practitioner", one slot per start time is returned and the
 * practitioner who leaves the fewest gaps is chosen.
 */

/** Half-open interval in epoch ms: [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface FinderPractitioner {
  id: string;
  /** Working hours; missing = business hours. Always limited to business hours. */
  hours?: WeeklyHours | null;
  /** Bookings (including their buffers) and time off. */
  busy: Interval[];
  maxPerDay?: number | null;
  /** Count of existing bookings per local date (YYYY-MM-DD), for maxPerDay. */
  bookingsPerDay?: Record<string, number>;
}

export interface FinderResource {
  id: string;
  /** Matched (case-insensitively) against the service's resource type. */
  type?: string | null;
  busy: Interval[];
}

export interface FinderService {
  durationMin: number;
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
  /** Who can do it; null/empty = anyone. */
  practitionerIds?: string[] | null;
  /** Needs a resource of this type; null = any resource (when resources are used). */
  resourceType?: string | null;
}

export interface FindSlotsInput {
  timezone: string;
  now: Date;
  /** First local day to search, and how many days. */
  from: LocalDate;
  days: number;
  businessHours: WeeklyHours;
  rules: { slotStepMin: number; minNoticeMin: number; horizonDays: number };
  service: FinderService;
  practitioners: FinderPractitioner[];
  /** null/undefined = bookings don't need a resource. */
  resources?: FinderResource[] | null;
  /** A specific practitioner; undefined = any. */
  practitionerId?: string;
}

export interface Slot {
  start: string;
  end: string;
  practitionerId: string;
  resourceId?: string;
}

const MIN = 60_000;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** "mon".."sun" for a local date. */
export function weekday(d: LocalDate): (typeof WEEKDAYS)[number] {
  const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(dow + 6) % 7];
}

/** Minute ranges [from, to) for a day, as the intersection of business and personal hours. */
export function workingRanges(day: LocalDate, business: WeeklyHours, own?: WeeklyHours | null): [number, number][] {
  const key = weekday(day);
  const biz = (business[key] ?? []).map(([a, b]) => [toMin(a), toMin(b)] as [number, number]);
  if (!own) return biz;
  const mine = (own[key] ?? []).map(([a, b]) => [toMin(a), toMin(b)] as [number, number]);
  const out: [number, number][] = [];
  for (const [a1, b1] of biz) for (const [a2, b2] of mine) {
    const a = Math.max(a1, a2);
    const b = Math.min(b1, b2);
    if (a < b) out.push([a, b]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Wall-clock minute of a local day → instant (DST-aware; minutes in a DST gap move forward). */
export function atLocal(day: LocalDate, minute: number, tz: string): number {
  return Date.parse(localDateTimeToIso(`${isoDate(day)}T${hhmm(minute)}`, tz)!);
}

const overlaps = (a: Interval, list: Interval[]) => list.some((b) => a.start < b.end && b.start < a.end);

/** Distance from an interval to the nearest busy edge or working-range edge (smaller = tighter packing). */
function gapScore(slot: Interval, busy: Interval[], range: Interval): number {
  let before = slot.start - range.start;
  let after = range.end - slot.end;
  for (const b of busy) {
    if (b.end <= slot.start) before = Math.min(before, slot.start - b.end);
    if (b.start >= slot.end) after = Math.min(after, b.start - slot.end);
  }
  return Math.min(before, after);
}

export function findSlots(input: FindSlotsInput): Slot[] {
  const { service, rules, timezone: tz } = input;
  const dur = service.durationMin * MIN;
  const before = (service.bufferBeforeMin ?? 0) * MIN;
  const after = (service.bufferAfterMin ?? 0) * MIN;
  if (dur <= 0 || rules.slotStepMin <= 0) return [];
  const earliest = input.now.getTime() + rules.minNoticeMin * MIN;
  const latest = input.now.getTime() + rules.horizonDays * 86_400_000;

  const allowed = service.practitionerIds?.length ? new Set(service.practitionerIds) : null;
  const candidates = input.practitioners
    .filter((p) => !allowed || allowed.has(p.id))
    .filter((p) => !input.practitionerId || p.id === input.practitionerId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const resources = input.resources
    ? input.resources
        .filter((r) => !service.resourceType || (r.type ?? "").toLowerCase() === service.resourceType.toLowerCase())
        .sort((a, b) => (a.id < b.id ? -1 : 1))
    : null;
  if (resources && resources.length === 0) return [];

  const slots: Slot[] = [];
  for (let i = 0; i < input.days; i++) {
    const day = addDays(input.from, i);
    const dayKey = isoDate(day);
    // start ms → best option for that start
    const byStart = new Map<number, { slot: Slot; score: number; load: number }>();

    for (const p of candidates) {
      if (p.maxPerDay != null && (p.bookingsPerDay?.[dayKey] ?? 0) >= p.maxPerDay) continue;
      for (const [from, to] of workingRanges(day, input.businessHours, p.hours)) {
        const range = { start: atLocal(day, from, tz), end: atLocal(day, to, tz) };
        // Steps are aligned to the clock (9:00, 9:15 …), not to the range start.
        for (let m = Math.ceil(from / rules.slotStepMin) * rules.slotStepMin; m + service.durationMin <= to; m += rules.slotStepMin) {
          const start = atLocal(day, m, tz);
          const end = start + dur;
          if (start < earliest || start > latest || end > range.end) continue;
          const needed = { start: start - before, end: end + after };
          if (overlaps(needed, p.busy)) continue;
          let resourceId: string | undefined;
          if (resources) {
            resourceId = resources.find((r) => !overlaps(needed, r.busy))?.id;
            if (!resourceId) continue;
          }
          const slot: Slot = { start: new Date(start).toISOString(), end: new Date(end).toISOString(), practitionerId: p.id, ...(resourceId ? { resourceId } : {}) };
          const score = gapScore(needed, p.busy, range);
          const load = p.bookingsPerDay?.[dayKey] ?? 0;
          const best = byStart.get(start);
          if (!best || score < best.score || (score === best.score && load < best.load)) byStart.set(start, { slot, score, load });
        }
      }
    }
    slots.push(...[...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.slot));
  }
  return slots;
}
