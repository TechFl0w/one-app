import type { Blueprint, RecurringCharge } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { valueMatches } from "./computed";
import { isoDate, localToday } from "./dates";

/**
 * Recurring charges (blueprint.recurring): rent every week, a membership every month. Each run
 * creates the charges that are coming due (a few days ahead) for every agreement that's still
 * on, from its start date to its end date — and never a second charge for the same due date.
 */

type Period = "week" | "2weeks" | "month";

/** How often, for this agreement: fixed, or from a choice field ("Weekly", "Every 2 weeks", "Monthly"). */
export function periodOf(bp: Blueprint, def: RecurringCharge, rec: RecordRow): Period | null {
  if (!def.every.startsWith("fld_")) return def.every as Period;
  const f = bp.tables.find((t) => t.id === def.table)?.fields.find((x) => x.id === def.every);
  const v = rec.data[def.every];
  const label = f && (f.type === "choice" || f.type === "status") ? f.options.find((o) => o.id === v)?.label ?? "" : String(v ?? "");
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
  } else d.setUTCDate(d.getUTCDate() + n * (p === "week" ? 7 : 14));
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
}

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
    for (const rec of agreements) {
      const start = typeof rec.data[def.start] === "string" ? String(rec.data[def.start]).slice(0, 10) : null;
      const amount = Number(rec.data[def.amount]);
      const period = periodOf(bp, def, rec);
      if (!start || !period || !Number.isFinite(amount) || amount <= 0) continue;
      // Re-checked every time: an agreement that's cancelled, ended or not signed gets nothing.
      if (!(def.when ?? []).every((w) => valueMatches(rec.data[w.field], w, today, now, bp.business.timezone))) continue;
      const end = def.end && typeof rec.data[def.end] === "string" ? String(rec.data[def.end]).slice(0, 10) : undefined;
      const existing = await b.query({ table: def.charges.table, filters: [{ field: def.charges.via, op: "eq", value: rec.id }], limit: 500 });
      const have = new Set(existing.records.map((c) => String(c.data[def.charges.due] ?? "").slice(0, 10)));
      for (const due of dueToCreate(start, end, period, today, def.leadDays ?? 3, have, backfillFrom)) {
        await b.createRecord(def.charges.table, { [def.charges.via]: rec.id, [def.charges.due]: due, [def.charges.amount]: amount });
        made++;
      }
    }
  }
  return made;
}
