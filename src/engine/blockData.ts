import { isComputedField, type Block, type Blueprint, type Field, type Table } from "@/schema/blueprint";
import type { RecordFilter, RecordQuery, RecordRow } from "@/schema/records";
import { loadAllVia, queryWithComputed } from "./computed";
import { buildAggregate, buildRecordQuery, RecordError, type QueryContext } from "./records";
import type { RecordStore } from "./store";

/** Loads what a block needs to render. Pure apart from the store, so the demo and tests can use it. */

/** id → display label for linked records. */
export type LinkLabels = Record<string, string>;

export type BlockData =
  | { kind: "records"; table: Table; records: RecordRow[]; total: number; labels: LinkLabels; groups?: Group[] }
  | { kind: "number"; table: Table; value: number | null; field?: Field }
  | { kind: "form"; table: Table; fields: Field[]; choices: Record<string, { id: string; label: string }[]> }
  | { kind: "static" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/** Columns of a board / calendar. `id: null` collects records without a value. */
export interface Group {
  id: string | null;
  label: string;
  color?: string;
}

export const DEFAULT_LIMITS = { table: 50, list: 20, board: 200, calendar: 500 } as const;

/** Display label of a record: its primary field, else the first text field, else a short id. */
export function recordLabel(table: Table, record: RecordRow, labels: LinkLabels = {}): string {
  const field =
    table.fields.find((f) => f.id === table.primaryField) ?? table.fields.find((f) => f.type === "text");
  const v = field ? record.data[field.id] : undefined;
  if (field?.type === "link" && typeof v === "string") return labels[v] ?? "—";
  if (v === undefined || v === null || v === "") return `#${record.id.slice(0, 6)}`;
  return String(v);
}

/** Resolves labels for every link field value in `records`. */
async function linkLabels(blueprint: Blueprint, table: Table, records: RecordRow[], store: RecordStore): Promise<LinkLabels> {
  const byTable = new Map<string, Set<string>>();
  for (const f of table.fields) {
    if (f.type !== "link") continue;
    for (const r of records) {
      const v = r.data[f.id];
      const ids = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
      const set = byTable.get(f.to) ?? new Set<string>();
      ids.forEach((id) => set.add(String(id)));
      byTable.set(f.to, set);
    }
  }
  const labels: LinkLabels = {};
  await Promise.all(
    [...byTable].map(async ([tableId, ids]) => {
      const target = blueprint.tables.find((t) => t.id === tableId);
      if (!target || !ids.size) return;
      for (const r of await store.getMany(tableId, [...ids])) labels[r.id] = recordLabel(target, r);
    }),
  );
  return labels;
}

const isGroupable = (f: Field) => f.type === "status" || ((f.type === "choice" || f.type === "link") && !f.multiple);

/** The field a board/calendar groups by: source.groupBy, else (boards) the first status field. */
export function groupField(table: Table, block: Block): Field | undefined {
  const explicit = table.fields.find((f) => f.id === block.source?.groupBy);
  if (explicit) return isGroupable(explicit) ? explicit : undefined;
  return block.type === "board" ? table.fields.find((f) => f.type === "status") : undefined;
}

/** The date field a calendar uses: source.field, else the first datetime field. */
export function calendarField(table: Table, block: Block): Field | undefined {
  const explicit = table.fields.find((f) => f.id === block.source?.field);
  if (explicit) return explicit.type === "datetime" || explicit.type === "date" ? explicit : undefined;
  return table.fields.find((f) => f.type === "datetime") ?? table.fields.find((f) => f.type === "date");
}

async function groupsFor(blueprint: Blueprint, field: Field, store: RecordStore, ctx: QueryContext): Promise<Group[]> {
  if (field.type === "status" || field.type === "choice") {
    return field.options.map((o) => ({ id: o.id, label: o.label, color: o.color }));
  }
  if (field.type === "link") {
    const target = blueprint.tables.find((t) => t.id === field.to);
    if (!target) return [];
    const { records } = await store.query(buildRecordQuery(blueprint, { table: target.id, limit: 50 }, ctx));
    return records.map((r) => ({ id: r.id, label: recordLabel(target, r) })).sort((a, b) => a.label.localeCompare(b.label));
  }
  return [];
}

/** Fields a form edits: options.fields (in that order) or all, minus ones simple forms can't set. */
export function formFieldsFor(table: Table, wanted?: unknown): Field[] {
  const ids = Array.isArray(wanted) && wanted.every(isStr) ? (wanted as string[]) : undefined;
  const fields = ids ? ids.map((id) => table.fields.find((f) => f.id === id)).filter((f): f is Field => !!f) : table.fields;
  return fields.filter((f) => !isComputedField(f) && !["file", "person", "hours"].includes(f.type));
}

const opt = <T>(v: unknown, guard: (x: unknown) => x is T): T | undefined => (guard(v) ? v : undefined);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string";

/** Records for a block; filters and sorts on computed fields (derived statuses, rollups) work too. */
function queryBlock(blueprint: Blueprint, store: RecordStore, query: RecordQuery, ctx: QueryContext) {
  return queryWithComputed(blueprint, query, (q) => store.query(buildRecordQuery(blueprint, q, ctx)), loadAllVia(store, blueprint), ctx.now);
}

const computedIn = (table: Table, ids: (string | undefined)[]) => ids.some((id) => { const f = table.fields.find((x) => x.id === id); return !!f && isComputedField(f); });

export async function loadBlockData(
  block: Block,
  blueprint: Blueprint,
  store: RecordStore,
  ctx: QueryContext = {},
): Promise<BlockData> {
  if (block.type === "notes") return { kind: "static" };
  if (!["table", "list", "board", "calendar", "number", "form"].includes(block.type)) return { kind: "unsupported" };
  if (!block.source) return { kind: "error", message: "This block has no data source yet." };
  const table = blueprint.tables.find((t) => t.id === block.source!.table);
  if (!table) return { kind: "error", message: "The table behind this block no longer exists." };

  try {
    switch (block.type) {
      case "number": {
        const src = block.source;
        if (computedIn(table, [src.field, ...(src.filters ?? []).map((f) => f.field)])) {
          // Counted after computing (the database doesn't store computed values).
          const { records } = await queryBlock(blueprint, store, { table: table.id, filters: src.filters ?? [], limit: 5000 }, ctx);
          const agg = src.agg ?? "count";
          const nums = records.map((r) => Number(r.data[src.field ?? ""])).filter((n) => Number.isFinite(n));
          const value = agg === "count" ? records.length : !nums.length ? null : agg === "sum" ? nums.reduce((a, b) => a + b, 0) : agg === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : agg === "min" ? Math.min(...nums) : Math.max(...nums);
          return { kind: "number", table, value, field: table.fields.find((f) => f.id === src.field) };
        }
        const value = await store.aggregate(buildAggregate(blueprint, block.source, ctx));
        return { kind: "number", table, value, field: table.fields.find((f) => f.id === block.source!.field) };
      }

      case "form": {
        const fields = formFieldsFor(table, block.options?.fields);
        const choices: Record<string, { id: string; label: string }[]> = {};
        for (const f of fields) {
          if (f.type === "link") choices[f.id] = await groupsFor(blueprint, f, store, ctx).then((g) => g.map(({ id, label }) => ({ id: id!, label })));
        }
        return { kind: "form", table, fields, choices };
      }

      case "board":
      case "calendar": {
        const filters: RecordFilter[] = [...(block.source.filters ?? [])];
        if (block.type === "calendar") {
          const dateField = calendarField(table, block);
          if (!dateField) return { kind: "error", message: `${table.label} has no date field to show on a calendar.` };
          const view = block.options?.view === "week" ? "@this_week" : "@today";
          filters.push({ field: dateField.id, op: "eq", value: view });
        }
        const gf = groupField(table, block);
        if (block.type === "board" && !gf) return { kind: "error", message: `Pick a status or choice field to group ${table.label} by.` };
        const { records, total } = await queryBlock(blueprint, store, { table: table.id, filters, sort: block.source.sort ?? [], limit: DEFAULT_LIMITS[block.type] }, ctx);
        const labels = await linkLabels(blueprint, table, records, store);
        const groups = gf ? await groupsFor(blueprint, gf, store, ctx) : undefined;
        return { kind: "records", table, records, total, labels, groups };
      }

      case "table":
      case "list": {
        const limit = Math.min(opt(block.options?.limit, isNum) ?? DEFAULT_LIMITS[block.type], 500);
        const { records, total } = await queryBlock(blueprint, store, { table: table.id, filters: block.source.filters ?? [], sort: block.source.sort ?? [], limit }, ctx);
        return { kind: "records", table, records, total, labels: await linkLabels(blueprint, table, records, store) };
      }
    }
  } catch (e) {
    if (e instanceof RecordError) return { kind: "error", message: e.message };
    throw e;
  }
  return { kind: "unsupported" };
}
