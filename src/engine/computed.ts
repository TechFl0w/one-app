import type { Blueprint, Field } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import type { RecordStore } from "./store";
import { buildRecordQuery } from "./records";
import { isoDate, localToday } from "./dates";

/**
 * Rollup fields, computed whenever records are read: "open repairs" on a room counts its
 * maintenance jobs that aren't done, "rent status" takes the status of its latest charge. Nothing
 * is stored, so the value is right however the underlying records changed (screen, table, import,
 * API, automation). Business rules live here, not in screen code.
 */

type Rollup = Extract<Field, { type: "rollup" }>;
type Where = NonNullable<Rollup["where"]>[number];
/** Loads every record of a table (bounded); called at most once per table per read. */
export type LoadTable = (tableId: string) => Promise<RecordRow[]>;

const MAX_ROWS = 5000;

export async function addComputed(bp: Blueprint, tableId: string, records: RecordRow[], loadTable: LoadTable, now = new Date()): Promise<RecordRow[]> {
  const table = bp.tables.find((t) => t.id === tableId);
  const rollups = (table?.fields ?? []).filter((f): f is Rollup => f.type === "rollup");
  if (!table || !rollups.length || !records.length) return records;
  const cache = new Map<string, Promise<RecordRow[]>>();
  const load = (t: string) => {
    if (!cache.has(t)) cache.set(t, loadTable(t));
    return cache.get(t)!;
  };
  const today = isoDate(localToday(now, bp.business.timezone));
  const out = records.map((r) => ({ ...r, data: { ...r.data } }));
  for (const f of rollups) {
    const source = f.from ?? table.fields.find((x): x is Extract<Field, { type: "link" }> => x.id === f.via && x.type === "link")?.to;
    if (!source) continue;
    const rows = (await load(source)).filter((c) => (f.where ?? []).every((w) => matches(c, w, today, now)));
    for (const r of out) {
      const linked = f.from
        ? rows.filter((c) => idsIn(c.data[f.via]).includes(r.id))
        : rows.filter((c) => idsIn(r.data[f.via]).includes(c.id));
      r.data[f.id] = aggregate(f, linked);
    }
  }
  return out;
}

const idsIn = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

function matches(r: RecordRow, w: Where, today: string, now: Date): boolean {
  const v = r.data[w.field];
  if (w.op === "empty") return empty(v);
  if (w.op === "not_empty") return !empty(v);
  const want = w.value === "@today" ? today : w.value === "@now" ? now.toISOString() : w.value;
  const have = Array.isArray(v) ? v : [v];
  if (w.op === "eq") return have.some((x) => x === want);
  if (w.op === "neq") return !have.some((x) => x === want);
  if (empty(v) || want === undefined) return false;
  // Dates compare as ISO strings (a date against a date-time compares the day part).
  const a = typeof want === "number" ? Number(v) : String(v).slice(0, String(want).length);
  const b = typeof want === "number" ? want : String(want);
  return w.op === "gt" ? a > b : w.op === "gte" ? a >= b : w.op === "lt" ? a < b : a <= b;
}

function aggregate(f: Rollup, rows: RecordRow[]): unknown {
  if (f.agg === "count") return rows.length;
  if (f.agg === "latest") {
    const key = (r: RecordRow) => String((f.sortBy ? r.data[f.sortBy] : r.createdAt) ?? "");
    const newest = [...rows].sort((a, b) => key(b).localeCompare(key(a)))[0];
    return newest ? (newest.data[f.field] ?? null) : null;
  }
  const nums = rows.map((r) => Number(r.data[f.field])).filter((n) => Number.isFinite(n));
  if (f.agg === "sum") return nums.reduce((a, b) => a + b, 0);
  if (!nums.length) return null;
  if (f.agg === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  return f.agg === "min" ? Math.min(...nums) : Math.max(...nums);
}

/** Reads every record of a table through a store, page by page. */
export function loadAllVia(store: Pick<RecordStore, "query">, bp: Blueprint): LoadTable {
  return async (tableId) => {
    const out: RecordRow[] = [];
    while (out.length < MAX_ROWS) {
      const page = await store.query(buildRecordQuery(bp, { table: tableId, limit: 500, offset: out.length }));
      out.push(...page.records);
      if (page.records.length < 500) break;
    }
    return out;
  };
}

/** A store whose reads include rollup values. */
export function withComputed(store: RecordStore, bp: Blueprint): RecordStore {
  const load = loadAllVia(store, bp);
  return {
    ...store,
    async query(p) {
      const r = await store.query(p);
      return { ...r, records: await addComputed(bp, p.p_table_id, r.records, load) };
    },
    async getMany(tableId, ids) {
      return addComputed(bp, tableId, await store.getMany(tableId, ids), load);
    },
  };
}
