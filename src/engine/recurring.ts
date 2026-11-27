import { isComputedField, type Blueprint, type RecurringCharge } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { valueMatches } from "./computed";
import { isoDate, localToday } from "./dates";

/**
 * Recurring charges (blueprint.recurring): rent every week, a membership every month. Each run
 * creates the charges that are coming due (a few days ahead) for every agreement that's still
 * on, from its start date to its end date — and never a second charge for the same due date.
 */

type Period = "week" | "2weeks" | "4weeks" | "month";

/** How often, for this agreement: fixed, or from a choice field ("Weekly", "Every 2 weeks", "Monthly"). */
export function periodOf(bp: Blueprint, def: RecurringCharge, rec: RecordRow): Period | null {
  if (!def.every.startsWith("fld_")) return def.every as Period;
  const f = bp.tables.find((t) => t.id === def.table)?.fields.find((x) => x.id === def.every);
  const v = rec.data[def.every];
  const label = f && (f.type === "choice" || f.type === "status") ? f.options.find((o) => o.id === v)?.label ?? "" : String(v ?? "");
  if (/4\s*weeks?/i.test(label)) return "4weeks";
  if (/2\s*weeks?|fortnight|bi-?weekly/i.test(label)) return "2weeks";
  if (/week/i.test(label)) return "week";
  if (/month/i.test(label)) return "month";
  return null;
}

const addPeriod = (iso: string, p: Period, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  if (p === "month") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    // The 31st in a 30-day month is the 30th (last day), not the 1st of the next.
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else d.setUTCDate(d.getUTCDate() + n * (p === "week" ? 7 : p === "2weeks" ? 14 : 28));
  return d.toISOString().slice(0, 10);
};

/**
 * The due dates to create now for one agreement: every period from the start, up to `today +
 * leadDays`, not after the end, not earlier than `backfillFrom`, and none that already has a charge.
 */
export function dueToCreate(start: string, end: string | undefined, period: Period, today: string, leadDays: number, existing: Set<string>, backfillFrom: string): string[] {
  const upto = new Date(Date.parse(`${today}T12:00:00Z`) + leadDays * 86_400_000).toISOString().slice(0, 10);
  const out: string[] = [];
  for (let n = 0; n < 1000; n++) {
    const due = addPeriod(start, period, n);
    if (due > upto || (end && due > end)) break;
    if (due >= backfillFrom && !existing.has(due)) out.push(due);
  }
  return out;
}

export interface RecurringBackend {
  query(q: { table: string; filters?: { field: string; op: "eq"; value: string }[]; limit?: number; offset?: number }): Promise<{ records: RecordRow[]; total: number }>;
  createRecord(table: string, values: Record<string, unknown>): Promise<RecordRow>;
  updateRecord?(table: string, id: string, values: Record<string, unknown>): Promise<unknown>;
  deleteRecord?(table: string, id: string): Promise<unknown>;
}

/** "2026-12-01" at the plan's time of day ("09:00" local) → an instant, in the business's zone. */
function atTime(day: string, hhmm: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = hhmm.split(":").map(Number);
  // The offset at that local time (two passes settle clock-change days).
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    const shown = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    t += Date.UTC(y, m - 1, d, h, min) - shown;
  }
  return new Date(t).toISOString();
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Creates the charges coming due for every recurring definition. Returns how many were made. */
export async function runRecurring(bp: Blueprint, b: RecurringBackend, now = new Date()): Promise<number> {
  const today = isoDate(localToday(now, bp.business.timezone));
  // Starting this feature on an old agreement doesn't bill months back: at most two weeks.
  const backfillFrom = new Date(Date.parse(`${today}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  let made = 0;
  for (const def of bp.recurring ?? []) {
    const agreements: RecordRow[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = await b.query({ table: def.table, limit: 500, offset });
      agreements.push(...page.records);
      if (page.records.length < 500) break;
    }
    const target = bp.tables.find((t) => t.id === def.charges.table);
    const dueField = target?.fields.find((f) => f.id === def.charges.due);
    const tz = bp.business.timezone;
    for (const rec of agreements) {
      const rawStart = typeof rec.data[def.start] === "string" ? String(rec.data[def.start]) : null;
      // A date-and-time start keeps its local time on every visit.
      const local = rawStart && rawStart.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(rawStart)) : null;
      const part = (k: string) => local?.find((x) => x.type === k)?.value ?? "";
      const start = local ? `${part("year")}-${part("month")}-${part("day")}` : rawStart?.slice(0, 10) ?? null;
      const time = local ? `${part("hour")}:${part("minute")}` : null;
      const amount = def.amount ? Number(rec.data[def.amount]) : undefined;
      const period = periodOf(bp, def, rec);
      if (!start || !period || (def.amount && (!Number.isFinite(amount) || amount! <= 0))) continue;
      const end = def.end && typeof rec.data[def.end] === "string" ? String(rec.data[def.end]).slice(0, 10) : undefined;
      // Re-checked every time: a plan that's cancelled, ended or not signed gets nothing new.
      const on = (def.when ?? []).every((w) => valueMatches(rec.data[w.field], w, today, now, tz));
      const existing = (await b.query({ table: def.charges.table, filters: [{ field: def.charges.via, op: "eq", value: rec.id }], limit: 500 })).records;
      const dayOfChild = (c: RecordRow) => {
        const v = String(c.data[def.charges.due] ?? "");
        return v.length > 10 ? new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(v)) : v.slice(0, 10);
      };
      // Nothing filled in beyond what the plan sets (statuses still at their first stage).
      const planKeys = new Set([def.charges.via, def.charges.due, def.charges.amount, ...(def.copy ?? []).map((c) => c.to)]);
      const untouched = (c: RecordRow) =>
        (target?.fields ?? []).every((f) => {
          if (planKeys.has(f.id) || isComputedField(f)) return true;
          const v = c.data[f.id];
          if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length)) return true;
          return (f.type === "status" || f.type === "choice") && "options" in f && f.options[0]?.id === v;
        });
      const copied = Object.fromEntries((def.copy ?? []).map((c) => [c.to, rec.data[c.from] ?? null]));
      const values = { ...copied, ...(def.charges.amount && amount !== undefined ? { [def.charges.amount]: amount } : {}) };
      // Future records follow the plan: edited details are copied over; ended or stopped plans lose them.
      for (const c of existing) {
        const d = dayOfChild(c);
        if (d <= today) continue;
        if (!untouched(c)) continue; // a rent paid ahead or a visit already worked on is left alone
        if ((!on || (end && d > end)) && b.deleteRecord) {
          await b.deleteRecord(def.charges.table, c.id);
          continue;
        }
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => !same(c.data[k], v)));
        if (Object.keys(changed).length && b.updateRecord) await b.updateRecord(def.charges.table, c.id, changed);
      }
      if (!on) continue;
      const have = new Set(existing.map(dayOfChild));
      // A deleted (skipped) one isn't made again: nothing on or before the latest one already made.
      const latest = [...have].sort().at(-1);
      const from = latest && latest > backfillFrom ? new Date(Date.parse(`${latest}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : backfillFrom;
      for (const due of dueToCreate(start, end, period, today, def.leadDays ?? 3, have, from)) {
        const when = dueField?.type === "datetime" ? atTime(due, time ?? "09:00", tz) : due;
        await b.createRecord(def.charges.table, { ...values, [def.charges.via]: rec.id, [def.charges.due]: when });
        made++;
      }
    }
  }
  return made;
}
