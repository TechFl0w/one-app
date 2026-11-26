import { isComputedField, type Blueprint, type DeriveRules, type Field } from "@/schema/blueprint";
import type { RecordQuery, RecordRow } from "@/schema/records";
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
  const derived = (table?.fields ?? []).filter((f): f is Derived => "derive" in f && !!f.derive);
  if (!table || (!rollups.length && !derived.length) || !records.length) return records;
  const cache = new Map<string, Promise<RecordRow[]>>();
  const today = isoDate(localToday(now, bp.business.timezone));
  // Linked records come with their derived statuses (a rent payment can look at its renter's status).
  const load = (t: string) => {
    if (!cache.has(t)) cache.set(t, loadTable(t).then((rows) => withDerived(bp, t, rows, today, now)));
    return cache.get(t)!;
  };
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
  // Derived statuses last: their rules may use rollups. Never stored, so never out of date.
  for (const f of derived) for (const r of out) r.data[f.id] = deriveOption(f, r.data, today, now);
  return out;
}

type Derived = Field & { derive: DeriveRules };

function withDerived(bp: Blueprint, tableId: string, rows: RecordRow[], today: string, now: Date): RecordRow[] {
  const derived = (bp.tables.find((t) => t.id === tableId)?.fields ?? []).filter((f): f is Derived => "derive" in f && !!f.derive);
  if (!derived.length) return rows;
  return rows.map((r) => {
    const data = { ...r.data };
    for (const f of derived) data[f.id] = deriveOption(f, data, today, now);
    return { ...r, data };
  });
}

/** The option a derived status shows for these values: the first rule that fully holds. */
export function deriveOption(f: Derived, data: Record<string, unknown>, today: string, now: Date): string | null {
  for (const rule of f.derive.rules) if (rule.when.every((w) => valueMatches(data[w.field], w, today, now))) return rule.option;
  return f.derive.otherwise ?? null;
}

/** "@today", "@now", "@today+30d", "@today-7d" → a concrete date / date-time; other values unchanged. */
export function resolveDateToken(value: unknown, today: string, now: Date): unknown {
  if (value === "@today") return today;
  if (value === "@now") return now.toISOString();
  const m = typeof value === "string" ? /^@today([+-])(\d{1,4})d$/.exec(value) : null;
  if (!m) return value;
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (m[1] === "-" ? -1 : 1) * Number(m[2]));
  return d.toISOString().slice(0, 10);
}

const idsIn = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const empty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

function matches(r: RecordRow, w: Where, today: string, now: Date): boolean {
  return valueMatches(r.data[w.field], w, today, now);
}

/** One condition against one value (rollup filters, derived statuses). */
export function valueMatches(v: unknown, w: Where, today: string, now: Date): boolean {
  if (w.op === "empty") return empty(v);
  if (w.op === "not_empty") return !empty(v);
  const want = resolveDateToken(w.value, today, now);
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

// ---------- queries on computed fields ----------

const isComputedId = (bp: Blueprint, tableId: string, fieldId: string) => {
  const f = bp.tables.find((t) => t.id === tableId)?.fields.find((x) => x.id === fieldId);
  return !!f && isComputedField(f);
};

/**
 * Runs a record query where filters or sorts may use computed fields (derived statuses,
 * rollups). Those aren't stored, so the database can't see them: the stored part runs there,
 * every matching row is computed (bounded), then the rest is filtered, sorted and paged here.
 */
export async function queryWithComputed(
  bp: Blueprint,
  query: RecordQuery,
  runStored: (q: RecordQuery) => Promise<{ records: RecordRow[]; total: number }>,
  loadTable: LoadTable,
  now = new Date(),
): Promise<{ records: RecordRow[]; total: number }> {
  const filters = query.filters ?? [];
  const sort = query.sort ?? [];
  const late = filters.filter((f) => isComputedId(bp, query.table, f.field));
  const lateSort = sort.some((s) => isComputedId(bp, query.table, s.field));
  if (!late.length && !lateSort) {
    const r = await runStored(query);
    return { ...r, records: await addComputed(bp, query.table, r.records, loadTable, now) };
  }
  const stored = { table: query.table, filters: filters.filter((f) => !late.includes(f)) };
  const rows: RecordRow[] = [];
  while (rows.length < MAX_ROWS) {
    const page = await runStored({ ...stored, limit: 500, offset: rows.length });
    rows.push(...page.records);
    if (page.records.length < 500) break;
  }
  const bpTable = bp.tables.find((t) => t.id === query.table);
  const today = isoDate(localToday(now, bp.business.timezone));
  let out = (await addComputed(bp, query.table, rows, loadTable, now)).filter((r) =>
    late.every((f) => (f.op === "contains" ? String(r.data[f.field] ?? "").toLowerCase().includes(String(f.value ?? "").toLowerCase()) : valueMatches(r.data[f.field], { field: f.field, op: f.op, value: f.value }, today, now))),
  );
  if (sort.length) {
    const val = (r: RecordRow, field: string) => (field === "_created_at" ? r.createdAt : field === "_updated_at" ? r.updatedAt : r.data[field]);
    // Choice/status values sort by their option order (Upcoming, Active, Ending…), others by value.
    const rank = (field: string, v: unknown) => {
      const f = bpTable?.fields.find((x) => x.id === field);
      const i = f && "options" in f ? f.options.findIndex((o) => o.id === v) : -1;
      return i >= 0 ? i : v;
    };
    out = [...out].sort((a, b) => {
      for (const s of sort) {
        const x = rank(s.field, val(a, s.field));
        const y = rank(s.field, val(b, s.field));
        if (x === y) continue;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return (s.dir === "desc" ? -c : c) || 0;
      }
      return 0;
    });
  }
  const offset = query.offset ?? 0;
  return { records: out.slice(offset, offset + (query.limit ?? 50)), total: out.length };
}
