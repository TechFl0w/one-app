import { DataSource, isComputedField, type Block, type Blueprint, type Field, type Table } from "@/schema/blueprint";
import type { RecordFilter, RecordQuery, RecordRow } from "@/schema/records";
import { loadAllVia, queryWithComputed } from "./computed";
import { RECORD_TOKEN } from "./recordPage";
import { buildAggregate, buildRecordQuery, RecordError, type QueryContext } from "./records";
import type { RecordStore } from "./store";
import type { AuditRow } from "./auditText";
import { documentFor, loadDocument, type DocView } from "./documents";
import { isoDate, localToday, startOfWeek } from "./dates";

/** Loads what a block needs to render. Pure apart from the store, so the demo and tests can use it. */

/** id → display label for linked records. */
export type LinkLabels = Record<string, string>;

export type BlockData =
  | { kind: "records"; table: Table; records: RecordRow[]; total: number; labels: LinkLabels; groups?: Group[] }
  | { kind: "number"; table: Table; value: number | null; field?: Field }
  | { kind: "form"; table: Table; fields: Field[]; choices: Record<string, { id: string; label: string }[]> }
  | { kind: "details"; table: Table; record: RecordRow; labels: LinkLabels }
  | { kind: "header"; stats: { label: string; value: number | null; field?: Field; tone?: string }[] }
  | { kind: "activity"; rows: AuditRow[] }
  | { kind: "document"; view: DocView; invoice?: { table: string; id: string } | null; canInvoice: boolean }
  | { kind: "static" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

/** Columns of a board / calendar. `id: null` collects records without a value. */
export interface Group {
  id: string | null;
  label: string;
  color?: string;
}

export const DEFAULT_LIMITS = { table: 50, list: 20, gallery: 60, board: 200, calendar: 500 } as const;

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
async function linkLabels(blueprint: Blueprint, raw: Table, records: RecordRow[], store: RecordStore): Promise<LinkLabels> {
  // Rollups of a link (a bay's current car) show as that link, so they need labels too.
  const table = displayTable(blueprint, raw);
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

/** A count / sum / … over a data source; computed fields are counted after computing. */
export async function aggregateOf(blueprint: Blueprint, store: RecordStore, src: DataSource, ctx: QueryContext): Promise<number | null> {
  const table = blueprint.tables.find((t) => t.id === src.table);
  if (!table) return null;
  if (computedIn(table, [src.field, ...(src.filters ?? []).map((f) => f.field)])) {
    const records: RecordRow[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const page = await queryBlock(blueprint, store, { table: table.id, filters: src.filters ?? [], limit: 500, offset }, ctx);
      records.push(...page.records);
      if (page.records.length < 500) break;
    }
    const agg = src.agg ?? "count";
    const nums = records.map((r) => Number(r.data[src.field ?? ""])).filter((n) => Number.isFinite(n));
    return agg === "count" ? records.length : !nums.length ? null : agg === "sum" ? nums.reduce((a, b) => a + b, 0) : agg === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : agg === "min" ? Math.min(...nums) : Math.max(...nums);
  }
  return store.aggregate(buildAggregate(blueprint, src, ctx));
}

/** A header's live line: options.stats = [{ table, filters?, agg?, field?, label, tone? }]. */
async function headerStats(blueprint: Blueprint, store: RecordStore, stats: unknown, ctx: QueryContext) {
  if (!Array.isArray(stats)) return [];
  const out: { label: string; value: number | null; field?: Field; tone?: string }[] = [];
  for (const raw of stats.slice(0, 6)) {
    const s = raw as Record<string, unknown>;
    const src = DataSource.safeParse({ table: s.table, filters: s.filters, agg: s.agg, field: s.field });
    if (!src.success || typeof s.label !== "string") continue;
    try {
      const value = await aggregateOf(blueprint, store, src.data, ctx);
      const table = blueprint.tables.find((t) => t.id === src.data.table);
      out.push({ label: s.label.slice(0, 60), value, field: table?.fields.find((f) => f.id === src.data.field), tone: typeof s.tone === "string" ? s.tone : undefined });
    } catch (e) {
      if (!(e instanceof RecordError)) throw e;
    }
  }
  return out;
}

export async function loadBlockData(
  original: Block,
  blueprint: Blueprint,
  store: RecordStore,
  ctx: QueryContext & { recordId?: string } = {},
): Promise<BlockData> {
  if (original.type === "notes") return { kind: "static" };
  if (original.type === "header") return { kind: "header", stats: await headerStats(blueprint, store, original.options?.stats, ctx) };
  if (!["table", "list", "gallery", "board", "calendar", "number", "form", "details", "activity", "document"].includes(original.type)) return { kind: "unsupported" };
  if (!original.source) return { kind: "error", message: "This block has no data source yet." };
  const table = blueprint.tables.find((t) => t.id === original.source!.table);
  if (!table) return { kind: "error", message: "The table behind this block no longer exists." };
  // On a record page, "@record" in a filter is the record the page is about.
  const scoped = (original.source.filters ?? []).some((f) => f.value === RECORD_TOKEN);
  if ((scoped || original.type === "details" || original.type === "activity" || original.type === "document") && !ctx.recordId) return { kind: "error", message: "This part shows one record; it appears on that record's page." };
  const block = (scoped ? { ...original, source: { ...original.source, filters: original.source.filters!.map((f) => (f.value === RECORD_TOKEN ? { ...f, value: ctx.recordId } : f)) } } : original) as Block & { source: NonNullable<Block["source"]> };

  try {
    switch (block.type) {
      case "number": {
        const value = await aggregateOf(blueprint, store, block.source, ctx);
        return { kind: "number", table, value, field: table.fields.find((f) => f.id === block.source!.field) };
      }

      case "document": {
        const def = documentFor(blueprint, table.id);
        if (!def) return { kind: "error", message: `${table.label} isn't set up as a quote or invoice yet.` };
        const [record] = await store.getMany(table.id, [ctx.recordId!]);
        if (!record) return { kind: "error", message: "This record was deleted." };
        const today = isoDate(localToday(ctx.now ?? new Date(), blueprint.business.timezone));
        const view = await loadDocument(blueprint, def, record, store, today);
        // An accepted quote can become an invoice (or shows the one it became).
        const inv = def.kind === "quote" ? blueprint.documents?.find((d) => d.kind === "invoice" && d.from?.document === def.id) : undefined;
        let invoice: { table: string; id: string } | null | undefined;
        if (inv) {
          const { records } = await store.query(buildRecordQuery(blueprint, { table: inv.table, filters: [{ field: inv.from!.link, op: "eq", value: record.id }], limit: 1 }, ctx));
          invoice = records[0] ? { table: inv.table, id: records[0].id } : null;
        }
        return { kind: "document", view, invoice, canInvoice: !!inv && view.state === "accepted" };
      }

      case "activity": {
        // The record and what hangs under it: a job's lines and payments, a client's bookings.
        const ids = [ctx.recordId!];
        for (const child of blueprint.tables) {
          for (const f of child.fields) {
            if (f.type !== "link" || f.to !== table.id || f.multiple) continue;
            const { records } = await store.query(buildRecordQuery(blueprint, { table: child.id, filters: [{ field: f.id, op: "eq", value: ctx.recordId! }], limit: 50 }, ctx));
            ids.push(...records.map((r) => r.id));
          }
        }
        return { kind: "activity", rows: store.history ? await store.history(ids, Math.min(opt(block.options?.limit, isNum) ?? 25, 100)) : [] };
      }

      case "details": {
        const [record] = await store.getMany(table.id, [ctx.recordId!]);
        if (!record) return { kind: "error", message: "This record was deleted." };
        return { kind: "details", table, record, labels: await linkLabels(blueprint, table, [record], store) };
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
          const week = block.options?.view === "week";
          const endField = table.fields.find((f) => f.id === block.options?.endField && (f.type === "date" || f.type === "datetime"));
          if (endField) {
            // Jobs that span days: anything that starts before the period ends and ends after it starts.
            const tz = ctx.timezone ?? blueprint.business.timezone;
            const today = localToday(ctx.now ?? new Date(), tz);
            const from = week ? Math.round((Date.UTC(startOfWeek(today).year, startOfWeek(today).month - 1, startOfWeek(today).day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000) : 0;
            const to = week ? from + 6 : 0;
            const tok = (n: number) => (n === 0 ? "@today" : `@today${n > 0 ? "+" : "-"}${Math.abs(n)}d`);
            filters.push({ field: dateField.id, op: "lt", value: tok(to + 1) }, { field: endField.id, op: "gte", value: tok(from) });
          } else filters.push({ field: dateField.id, op: "eq", value: week ? "@this_week" : "@today" });
        }
        const gf = groupField(table, block);
        if (block.type === "board" && !gf) return { kind: "error", message: `Pick a status or choice field to group ${table.label} by.` };
        const { records, total } = await queryBlock(blueprint, store, { table: table.id, filters, sort: block.source.sort ?? [], limit: DEFAULT_LIMITS[block.type] }, ctx);
        const labels = await linkLabels(blueprint, table, records, store);
        const groups = gf ? await groupsFor(blueprint, gf, store, ctx) : undefined;
        return { kind: "records", table, records, total, labels, groups };
      }

      case "table":
      case "gallery":
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

/**
 * The table as blocks should show it: a rollup of a status/choice/date shows like that field (a
 * payment's "Lease status" is a coloured badge), a sum of money shows as money.
 */
export function displayTable(bp: Blueprint, table: Table): Table {
  const fields = table.fields.map((f): Field => {
    if (f.type !== "rollup") return f;
    const via = f.from ? undefined : table.fields.find((x) => x.id === f.via);
    const target = bp.tables.find((t) => t.id === (f.from ?? (via?.type === "link" ? via.to : undefined)));
    const src = target?.fields.find((x) => x.id === f.field);
    if (!src) return f;
    if (f.agg === "latest" || ((f.agg === "min" || f.agg === "max") && (src.type === "date" || src.type === "datetime")))
      return { ...src, id: f.id, label: f.label, required: false, ...("derive" in src ? { derive: undefined } : {}) } as Field;
    if (!f.format && src.type === "money" && f.agg !== "count") return { ...f, format: "money" };
    return f;
  });
  return { ...table, fields };
}
