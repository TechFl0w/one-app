import { z } from "zod";
import type { Blueprint, Field, Table } from "@/schema/blueprint";
import { FileValue, RecordInput, RecordQuery, type FilterOp } from "@/schema/records";

/**
 * Pure rules for records: validate values against the blueprint, turn stored rows into views,
 * and turn a query into the parameters of the `query_records` RPC.
 */

export class RecordError extends Error {
  constructor(
    public readonly code: "invalid" | "not_found" | "needs_confirmation",
    message: string,
    public readonly fieldErrors: { field: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "RecordError";
  }
}

export function tableOrThrow(blueprint: Blueprint, tableId: string): Table {
  const t = blueprint.tables.find((x) => x.id === tableId);
  if (!t) throw new RecordError("not_found", `Table ${tableId} not found`);
  return t;
}

// ---------- values ----------

const COMPUTED: Field["type"][] = ["formula", "rollup"];
const uuid = z.uuid();
const email = z.email();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+?[0-9 ()\-.]{5,25}$/;

const isValidDate = (s: string) => {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

type Check = { ok: true; value: unknown } | { ok: false; message: string };
const ok = (value: unknown): Check => ({ ok: true, value });
const bad = (message: string): Check => ({ ok: false, message });

/** Validates and normalises one non-null value for a field. */
export function checkValue(field: Field, value: unknown): Check {
  switch (field.type) {
    case "text":
    case "long_text": {
      const max = field.type === "text" ? 1000 : 20000;
      if (typeof value !== "string") return bad("must be text");
      return value.length > max ? bad(`must be at most ${max} characters`) : ok(value);
    }
    case "phone":
      return typeof value === "string" && PHONE_RE.test(value.trim()) ? ok(value.trim()) : bad("must be a phone number");
    case "email":
      return typeof value === "string" && email.safeParse(value.trim()).success
        ? ok(value.trim().toLowerCase())
        : bad("must be an email address");
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? ok(value) : bad("must be a number");
    case "money":
      if (typeof value !== "number" || !Number.isFinite(value)) return bad("must be an amount");
      return Math.abs(Math.round(value * 100) - value * 100) > 1e-6 ? bad("must have at most 2 decimals") : ok(value);
    case "checkbox":
      return typeof value === "boolean" ? ok(value) : bad("must be true or false");
    case "date":
      return typeof value === "string" && isValidDate(value) ? ok(value) : bad("must be a date (YYYY-MM-DD)");
    case "datetime": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
        return bad("must be a date and time with timezone (ISO 8601)");
      }
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? bad("must be a valid date and time") : ok(d.toISOString());
    }
    case "status":
    case "choice": {
      const ids = new Set(field.options.map((o) => o.id));
      if (field.multiple) {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !ids.has(v))) {
          return bad("must be a list of the field's options");
        }
        return ok([...new Set(value as string[])]);
      }
      return typeof value === "string" && ids.has(value) ? ok(value) : bad("must be one of the field's options");
    }
    case "person":
      return typeof value === "string" && uuid.safeParse(value).success ? ok(value) : bad("must be a person id");
    case "link": {
      if (field.multiple) {
        if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !uuid.safeParse(v).success)) {
          return bad("must be a list of record ids");
        }
        return ok([...new Set(value as string[])]);
      }
      return typeof value === "string" && uuid.safeParse(value).success ? ok(value) : bad("must be a record id");
    }
    case "file": {
      const r = FileValue.safeParse(value);
      return r.success ? ok(r.data) : bad("must be an uploaded file");
    }
    case "formula":
    case "rollup":
      return bad("is calculated and cannot be set");
  }
}

/**
 * Validates input for a create (`required` enforced) or update (only given fields).
 * Returns data keyed by field id, ready to store. Throws RecordError with per-field messages.
 */
export function validateRecordInput(
  table: Table,
  input: unknown,
  mode: "create" | "update",
): Record<string, unknown> {
  const parsed = RecordInput.safeParse(input);
  if (!parsed.success) {
    throw new RecordError("invalid", "Record values must be an object keyed by field id");
  }
  const fields = new Map(table.fields.map((f) => [f.id, f]));
  const errors: { field: string; message: string }[] = [];
  const out: Record<string, unknown> = {};

  for (const [fieldId, value] of Object.entries(parsed.data)) {
    const field = fields.get(fieldId);
    if (!field) {
      errors.push({ field: fieldId, message: `Unknown field on ${table.label}` });
      continue;
    }
    if (value === null || value === undefined || value === "") {
      if (COMPUTED.includes(field.type)) errors.push({ field: fieldId, message: `${field.label} is calculated and cannot be set` });
      else if (field.required) errors.push({ field: fieldId, message: `${field.label} is required` });
      else out[fieldId] = null;
      continue;
    }
    const r = checkValue(field, value);
    if (r.ok) out[fieldId] = r.value;
    else errors.push({ field: fieldId, message: `${field.label} ${r.message}` });
  }

  if (mode === "create") {
    for (const f of table.fields) {
      if (f.required && !COMPUTED.includes(f.type) && !(f.id in out) && !errors.some((e) => e.field === f.id)) {
        errors.push({ field: f.id, message: `${f.label} is required` });
      }
    }
  }

  if (errors.length) throw new RecordError("invalid", errors.map((e) => e.message).join("; "), errors);
  return out;
}

/** Linked record ids in validated data, grouped by target table (to check they exist). */
export function linkedIds(table: Table, data: Record<string, unknown>): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  for (const f of table.fields) {
    if (f.type !== "link" || data[f.id] == null) continue;
    const ids = Array.isArray(data[f.id]) ? (data[f.id] as string[]) : [data[f.id] as string];
    const set = byTable.get(f.to) ?? new Set();
    ids.forEach((id) => set.add(id));
    byTable.set(f.to, set);
  }
  return byTable;
}

/** Keeps only fields that exist in the blueprint now (removed fields' data stays stored, but hidden). */
export function projectData(table: Table, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of table.fields) if (f.id in data) out[f.id] = data[f.id];
  return out;
}

// ---------- queries ----------

export type FieldKind = "text" | "number" | "bool" | "date" | "datetime" | "array";

/** How a field is compared in queries; null = not filterable/sortable. */
export function fieldKind(field: Field): FieldKind | null {
  switch (field.type) {
    case "text":
    case "long_text":
    case "phone":
    case "email":
    case "person":
      return "text";
    case "number":
    case "money":
      return "number";
    case "checkbox":
      return "bool";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "status":
    case "choice":
    case "link":
      return field.multiple ? "array" : "text";
    case "file":
    case "formula":
    case "rollup":
      return null;
  }
}

const OPS_BY_KIND: Record<FieldKind, FilterOp[]> = {
  text: ["eq", "neq", "contains", "empty", "not_empty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"],
  date: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"],
  datetime: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"],
  bool: ["eq", "neq", "empty", "not_empty"],
  array: ["contains", "empty", "not_empty"],
};

export interface QueryRecordsParams {
  p_table_id: string;
  p_filters: { field: string; op: FilterOp; value?: string; kind: FieldKind }[];
  p_sort: { field: string; dir: "asc" | "desc"; kind?: FieldKind }[];
  p_limit: number;
  p_offset: number;
}

/** Validates a query against the blueprint and builds `query_records` RPC params. */
export function buildRecordQuery(blueprint: Blueprint, query: RecordQuery): QueryRecordsParams {
  const parsed = RecordQuery.safeParse(query);
  if (!parsed.success) throw new RecordError("invalid", `Invalid query: ${parsed.error.issues[0].message}`);
  const q = parsed.data;
  const table = tableOrThrow(blueprint, q.table);
  const fields = new Map(table.fields.map((f) => [f.id, f]));
  const errors: { field: string; message: string }[] = [];

  const p_filters = q.filters.flatMap((flt): QueryRecordsParams["p_filters"] => {
    const field = fields.get(flt.field);
    const kind = field && fieldKind(field);
    if (!field || !kind) {
      errors.push({ field: flt.field, message: field ? `${field.label} cannot be filtered` : "Unknown field" });
      return [];
    }
    if (!OPS_BY_KIND[kind].includes(flt.op)) {
      errors.push({ field: flt.field, message: `${field.label} does not support "${flt.op}"` });
      return [];
    }
    if (flt.op === "empty" || flt.op === "not_empty") return [{ field: flt.field, op: flt.op, kind }];
    if (flt.value === undefined) {
      errors.push({ field: flt.field, message: `${field.label}: "${flt.op}" needs a value` });
      return [];
    }
    // contains on a text field is a substring search, so any text is fine.
    const check = flt.op === "contains" && kind === "text"
      ? (typeof flt.value === "string" ? ok(flt.value) : bad("needs text"))
      : checkValue(kind === "array" ? { ...field, multiple: false } as Field : field, flt.value);
    if (!check.ok) {
      errors.push({ field: flt.field, message: `${field.label} ${check.message}` });
      return [];
    }
    return [{ field: flt.field, op: flt.op, kind, value: String(check.value) }];
  });

  const p_sort = q.sort.flatMap((s): QueryRecordsParams["p_sort"] => {
    if (s.field === "_created_at" || s.field === "_updated_at") return [{ field: s.field, dir: s.dir }];
    const field = fields.get(s.field);
    const kind = field && fieldKind(field);
    if (!field || !kind || kind === "array") {
      errors.push({ field: s.field, message: field ? `${field.label} cannot be sorted` : "Unknown field" });
      return [];
    }
    return [{ field: s.field, dir: s.dir, kind }];
  });

  if (errors.length) throw new RecordError("invalid", errors.map((e) => e.message).join("; "), errors);
  return { p_table_id: table.id, p_filters, p_sort, p_limit: q.limit, p_offset: q.offset };
}
