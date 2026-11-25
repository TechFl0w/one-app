import type { RecordRow } from "@/schema/records";
import type { AggregateParams, QueryRecordsParams } from "./records";

/**
 * What blocks need from storage. Implemented by Supabase (src/server/store.ts) and in memory
 * (below, for the demo and tests). Params are already validated against the blueprint.
 */
export interface RecordStore {
  query(params: QueryRecordsParams): Promise<{ records: RecordRow[]; total: number }>;
  aggregate(params: AggregateParams): Promise<number | null>;
  getMany(tableId: string, ids: string[]): Promise<RecordRow[]>;
}

// ---------- in-memory implementation (mirrors the SQL in query_records / records_where) ----------

type Filter = QueryRecordsParams["p_filters"][number];

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function cast(v: unknown, kind: Filter["kind"]): number | string | boolean | null {
  if (v === undefined || v === null) return null;
  switch (kind) {
    case "number":
      return Number(v);
    case "bool":
      return v === true || v === "true";
    case "datetime":
      return new Date(String(v)).getTime();
    default:
      return String(v);
  }
}

function matches(data: Record<string, unknown>, f: Filter): boolean {
  const raw = data[f.field];
  if (f.op === "empty") return isEmpty(raw);
  if (f.op === "not_empty") return !isEmpty(raw);
  if (f.kind === "array") return Array.isArray(raw) ? raw.includes(f.value) : raw === f.value;
  if (f.op === "contains") return raw != null && String(raw).toLowerCase().includes(String(f.value).toLowerCase());
  const a = cast(raw, f.kind);
  const b = cast(f.value, f.kind);
  if (f.op === "neq") return a === null || a !== b;
  if (a === null || b === null) return false;
  switch (f.op) {
    case "eq":
      return a === b;
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
  }
  return false;
}

function compare(a: RecordRow, b: RecordRow, sort: QueryRecordsParams["p_sort"]): number {
  for (const s of sort) {
    const get = (r: RecordRow) =>
      s.field === "_created_at" ? Date.parse(r.createdAt) : s.field === "_updated_at" ? Date.parse(r.updatedAt) : cast(r.data[s.field], s.kind ?? "text");
    const x = get(a);
    const y = get(b);
    if (x === y) continue;
    if (x === null) return 1; // nulls last
    if (y === null) return -1;
    const c = x < y ? -1 : 1;
    return s.dir === "desc" ? -c : c;
  }
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function memoryQuery(rows: RecordRow[], p: QueryRecordsParams) {
  const hits = rows.filter((r) => r.tableId === p.p_table_id && p.p_filters.every((f) => matches(r.data, f)));
  hits.sort((a, b) => compare(a, b, p.p_sort));
  return { records: hits.slice(p.p_offset, p.p_offset + p.p_limit), total: hits.length };
}

export function memoryAggregate(rows: RecordRow[], p: AggregateParams): number | null {
  const hits = rows.filter((r) => r.tableId === p.p_table_id && p.p_filters.every((f) => matches(r.data, f)));
  if (p.p_agg === "count") return hits.length;
  const nums = hits.map((r) => r.data[p.p_field!]).filter((v) => v != null).map(Number);
  if (!nums.length) return null;
  switch (p.p_agg) {
    case "sum":
      return nums.reduce((s, n) => s + n, 0);
    case "avg":
      return nums.reduce((s, n) => s + n, 0) / nums.length;
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

export function memoryStore(rows: RecordRow[]): RecordStore {
  return {
    query: async (p) => memoryQuery(rows, p),
    aggregate: async (p) => memoryAggregate(rows, p),
    getMany: async (tableId, ids) => rows.filter((r) => r.tableId === tableId && ids.includes(r.id)),
  };
}
