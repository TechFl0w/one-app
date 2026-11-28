import type { Blueprint, Table } from "@/schema/blueprint";
import type { RecordFilter } from "@/schema/records";
import { buildRecordQuery, type QueryContext } from "./records";
import type { RecordStore } from "./store";
import { recordLabel } from "./blockData";

/**
 * Search and filters for tables and lists, and the app-wide search.
 * A block's search lives in the page address: `?blk_x.q=lisa&blk_x.fld_stage=opt_won`, so a
 * filtered list can be shared or bookmarked, and the server loads exactly what's shown.
 */

export type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Date filters in plain words, as the filters they stand for. */
export const DATE_FILTERS: Record<string, { label: string; filters: (field: string) => RecordFilter[] }> = {
  today: { label: "Today", filters: (f) => [{ field: f, op: "eq", value: "@today" }] },
  week: { label: "This week", filters: (f) => [{ field: f, op: "eq", value: "@this_week" }] },
  month: { label: "This month", filters: (f) => [{ field: f, op: "eq", value: "@this_month" }] },
  past: { label: "Before today", filters: (f) => [{ field: f, op: "lt", value: "@today" }] },
  upcoming: { label: "Today or later", filters: (f) => [{ field: f, op: "gte", value: "@today" }] },
  empty: { label: "Not set", filters: (f) => [{ field: f, op: "empty" }] },
};

/** The fields a block can be filtered by: choices and statuses, yes/no, dates, people and other links. */
export function filterableFields(table: Table) {
  return table.fields.filter((f) => f.type === "status" || f.type === "choice" || f.type === "checkbox" || f.type === "date" || f.type === "datetime" || f.type === "link");
}

/** The search and filters the address asks of one block. Unknown fields and values are ignored. */
export function blockQuery(table: Table, blockId: string, params: Params | undefined): { q?: string; filters: RecordFilter[]; active: Record<string, string> } {
  const out: RecordFilter[] = [];
  const active: Record<string, string> = {};
  if (!params) return { filters: out, active };
  const q = one(params[`${blockId}.q`])?.trim().slice(0, 100) || undefined;
  for (const f of filterableFields(table)) {
    const v = one(params[`${blockId}.${f.id}`]);
    if (!v) continue;
    if (f.type === "date" || f.type === "datetime") {
      if (DATE_FILTERS[v]) out.push(...DATE_FILTERS[v].filters(f.id));
      else continue;
    } else if (f.type === "checkbox") out.push({ field: f.id, op: "eq", value: v === "yes" });
    else if (f.type === "link") out.push({ field: f.id, op: f.multiple ? "contains" : "eq", value: v.slice(0, 64) });
    else if ("options" in f && f.options.some((o) => o.id === v)) out.push({ field: f.id, op: f.multiple ? "contains" : "eq", value: v });
    else continue;
    active[f.id] = v;
  }
  return { q, filters: out, active };
}

/** Records of linked tables whose name has the words, so "Lisa" finds Lisa's jobs and invoices too. */
export async function matchingLinks(bp: Blueprint, store: RecordStore, table: Table, q: string, ctx: QueryContext = {}): Promise<string[]> {
  const targets = [...new Set(table.fields.flatMap((f) => (f.type === "link" ? [f.to] : [])))].filter((t) => t !== table.id).slice(0, 6);
  const ids: string[] = [];
  for (const t of targets) {
    if (!bp.tables.some((x) => x.id === t)) continue;
    const { records } = await store.query(buildRecordQuery(bp, { table: t, search: { q }, limit: 30 }, ctx));
    ids.push(...records.map((r) => r.id));
  }
  return ids.slice(0, 200);
}

export interface SearchHit {
  table: string;
  tableLabel: string;
  id: string;
  title: string;
}

/** App-wide search: a few matches from every table, the most relevant tables first. */
export async function searchEverything(bp: Blueprint, store: RecordStore, q: string, ctx: QueryContext = {}, perTable = 5): Promise<SearchHit[]> {
  const term = q.trim().slice(0, 100);
  if (term.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const t of bp.tables.slice(0, 30)) {
    const { records } = await store.query(buildRecordQuery(bp, { table: t.id, search: { q: term }, limit: perTable }, ctx)).catch(() => ({ records: [] as never[] }));
    for (const r of records) hits.push({ table: t.id, tableLabel: t.label, id: r.id, title: recordLabel(t, r) });
  }
  // Titles that start with the words first, then titles that have them, then the rest.
  const low = term.toLowerCase();
  const rank = (h: SearchHit) => (h.title.toLowerCase().startsWith(low) ? 0 : h.title.toLowerCase().includes(low) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b)).slice(0, 40);
}
