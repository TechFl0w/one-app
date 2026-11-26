import { isComputedField, type Field, type Table } from "@/schema/blueprint";
import { newId } from "@/engine/editing";
import { localDateTimeToIso } from "@/engine/dates";

/**
 * Spreadsheet import, pure parts: parse CSV, guess field types for a new table, match columns to
 * existing fields, and turn cells into record values. Validation still happens in
 * validateRecordInput when the rows are saved.
 */

export const MAX_IMPORT_ROWS = 5000;

/** RFC 4180-ish: quotes, "" escapes, newlines inside quotes, BOM; separator , ; or tab (guessed). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- values ----------

const TRUE = new Set(["yes", "y", "true", "1", "x", "✓", "ja", "oui", "si"]);
const FALSE = new Set(["no", "n", "false", "0", "", "nee", "non"]);

export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/[\s$€£¥]|[A-Z]{3}$/g, "").replace(/^[A-Z]{3}/, "");
  if (!s) return null;
  if (/^-?\(.*\)$/.test(s)) s = `-${s.replace(/[()]/g, "")}`;
  // 1.234,56 (European) vs 1,234.56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s.replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

export type DateOrder = "mdy" | "dmy";

/** YYYY-MM-DD from common spreadsheet date formats (and the time part, when present). */
export function parseDate(raw: string, order: DateOrder = "mdy"): { date: string; time?: string } | null {
  const s = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*(am|pm)?)?/i.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?$/i.exec(s);
    if (!m) {
      const t = Date.parse(s);
      if (Number.isNaN(t) || !/[a-z]/i.test(s)) return null;
      const dt = new Date(t);
      return { date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}` };
    }
    const a = +m[1];
    const b = +m[2];
    y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    // A day over 12 settles the order; otherwise use the chosen one.
    [mo, d] = a > 12 ? [b, a] : b > 12 ? [a, b] : order === "mdy" ? [a, b] : [b, a];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (m[4] === undefined) return { date };
  let h = +m[4];
  const ap = m[6]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return { date, time: `${String(h).padStart(2, "0")}:${m[5]}` };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d\s().-]{7,20}$/;

// ---------- new tables: guess fields ----------

/** A field for a CSV column, from its header and values. */
export function inferField(header: string, values: string[], taken: Set<string>, order: DateOrder = "mdy"): Field {
  const id = newId("fld", header || "column", taken);
  taken.add(id);
  const label = header.trim().slice(0, 80) || "Column";
  const filled = values.map((v) => v.trim()).filter(Boolean);
  const all = (test: (v: string) => boolean) => filled.length > 0 && filled.every(test);
  const h = norm(header);
  if (all((v) => EMAIL.test(v))) return { id, label, type: "email" };
  if (all((v) => PHONE.test(v) && v.replace(/\D/g, "").length >= 7) && /phone|mobile|cell|tel|whatsapp/.test(h)) return { id, label, type: "phone" };
  if (all((v) => TRUE.has(v.toLowerCase()) || FALSE.has(v.toLowerCase())) && filled.some((v) => !/^\d+$/.test(v))) return { id, label, type: "checkbox" };
  if (all((v) => /[$€£]/.test(v) && parseNumber(v) !== null) || (/price|amount|total|cost|fee|paid|revenue|rent/.test(h) && all((v) => parseNumber(v) !== null))) return { id, label, type: "money" };
  if (all((v) => parseNumber(v) !== null)) return { id, label, type: "number" };
  if (all((v) => parseDate(v, order) !== null)) return { id, label, type: filled.some((v) => parseDate(v, order)?.time) ? "datetime" : "date" };
  const distinct = [...new Set(filled)];
  if (filled.length >= 6 && distinct.length <= 12 && distinct.length <= filled.length / 2 && distinct.every((v) => v.length <= 40)) {
    const optTaken = new Set<string>();
    return { id, label, type: "choice", options: distinct.map((v) => ({ id: newId("opt", v, optTaken), label: v })).map((o) => (optTaken.add(o.id), o)) };
  }
  if (filled.some((v) => v.length > 120 || v.includes("\n"))) return { id, label, type: "long_text" };
  return { id, label, type: "text" };
}

/** Which existing field each CSV column fills (by label), or null to skip it. */
export function autoMap(headers: string[], table: Table): (string | null)[] {
  const used = new Set<string>();
  const editable = table.fields.filter((f) => !isComputedField(f) && !["file", "hours", "person"].includes(f.type));
  // Compare without spaces/punctuation: "E-mail" = "Email", "Full name" contains "Name".
  const key = (s: string) => norm(s).replace(/ /g, "");
  return headers.map((h) => {
    const n = key(h);
    const f = editable.find((x) => !used.has(x.id) && key(x.label) === n) ?? editable.find((x) => !used.has(x.id) && n.length > 2 && (key(x.label).includes(n) || n.includes(key(x.label))));
    if (!f) return null;
    used.add(f.id);
    return f.id;
  });
}

// ---------- cells → values ----------

export interface CoerceContext {
  timezone: string;
  dateOrder: DateOrder;
  /** Record id for a label in a linked table (by its title field), if any. */
  linkId?: (tableId: string, label: string) => string | undefined;
}

export function coerceCell(field: Field, raw: string, ctx: CoerceContext): { value: unknown } | { error: string } {
  const s = raw.trim();
  if (s === "") return { value: null };
  switch (field.type) {
    case "number":
    case "money": {
      const n = parseNumber(s);
      return n === null ? { error: `“${s}” isn’t a number` } : { value: n };
    }
    case "checkbox":
      if (TRUE.has(s.toLowerCase())) return { value: true };
      if (FALSE.has(s.toLowerCase())) return { value: false };
      return { error: `“${s}” isn’t yes or no` };
    case "date": {
      const d = parseDate(s, ctx.dateOrder);
      return d ? { value: d.date } : { error: `“${s}” isn’t a date` };
    }
    case "datetime": {
      const d = parseDate(s, ctx.dateOrder);
      if (!d) return { error: `“${s}” isn’t a date and time` };
      const iso = localDateTimeToIso(`${d.date}T${d.time ?? "09:00"}`, ctx.timezone);
      return iso ? { value: iso } : { error: `“${s}” isn’t a valid time` };
    }
    case "status":
    case "choice": {
      const parts = field.multiple ? s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : [s];
      const ids = parts.map((p) => field.options.find((o) => norm(o.label) === norm(p) || o.id === p)?.id);
      const bad = parts.find((_, i) => !ids[i]);
      if (bad) return { error: `“${bad}” isn’t one of: ${field.options.map((o) => o.label).join(", ")}` };
      return { value: field.multiple ? ids : ids[0] };
    }
    case "link": {
      const parts = field.multiple ? s.split(/[;,]/).map((x) => x.trim()).filter(Boolean) : [s];
      const ids = parts.map((p) => ctx.linkId?.(field.to, p));
      const bad = parts.find((_, i) => !ids[i]);
      if (bad) return { error: `No match for “${bad}”` };
      return { value: field.multiple ? ids : ids[0] };
    }
    case "email":
      return EMAIL.test(s) ? { value: s } : { error: `“${s}” isn’t an email address` };
    case "formula":
    case "rollup":
    case "file":
    case "hours":
    case "person":
      return { value: null };
    default:
      return { value: s.slice(0, field.type === "long_text" ? 20_000 : 1000) };
  }
}

export interface RowProblem {
  row: number; // 1-based data row (header excluded)
  field: string;
  message: string;
}

/** Converts data rows with a column → field mapping. Rows with problems are reported, not imported. */
export function buildRecords(rows: string[][], mapping: (string | null)[], table: Table, ctx: CoerceContext): { records: Record<string, unknown>[]; problems: RowProblem[]; skipped: number } {
  const records: Record<string, unknown>[] = [];
  const problems: RowProblem[] = [];
  let skipped = 0;
  rows.forEach((cells, i) => {
    const data: Record<string, unknown> = {};
    let ok = true;
    mapping.forEach((fieldId, col) => {
      if (!fieldId) return;
      const f = table.fields.find((x) => x.id === fieldId);
      if (!f) return;
      const r = coerceCell(f, cells[col] ?? "", ctx);
      if ("error" in r) {
        ok = false;
        problems.push({ row: i + 1, field: f.label, message: r.error });
      } else if (r.value !== null && r.value !== undefined) data[f.id] = r.value;
    });
    for (const f of table.fields) {
      if (ok && f.required && (data[f.id] === undefined || data[f.id] === "")) {
        ok = false;
        problems.push({ row: i + 1, field: f.label, message: "is required" });
      }
    }
    if (ok) records.push(data);
    else skipped++;
  });
  return { records, problems, skipped };
}
