import type { Blueprint } from "@/schema/blueprint";

/**
 * Checks before a component is saved that every table, field, option and page id written in its
 * code exists in the setup — a typo or a stale id would otherwise fail silently at runtime.
 * Only whole string literals count ("fld_name"), so prefixes built at runtime aren't flagged.
 */
export function checkReferences(source: string, bp: Blueprint, extraPages: string[] = []): string[] {
  const tables = new Set(bp.tables.map((t) => t.id));
  const fields = new Set(bp.tables.flatMap((t) => t.fields.map((f) => f.id)));
  const options = new Set(bp.tables.flatMap((t) => t.fields.flatMap((f) => ("options" in f && Array.isArray(f.options) ? f.options.map((o) => o.id) : []))));
  const pages = new Set([...bp.pages.map((p) => p.id), ...extraPages]);
  const known: Record<string, Set<string>> = { tbl: tables, fld: fields, opt: options, pg: pages };
  const what: Record<string, string> = { tbl: "table", fld: "field", opt: "choice option", pg: "page" };
  const errors = new Set<string>();
  for (const m of source.matchAll(/["'`]((tbl|fld|opt|pg)_[a-z0-9_]{1,60})["'`]/g)) {
    if (!known[m[2]].has(m[1])) errors.add(`Unknown ${what[m[2]]} ${m[1]} — use an id from the current setup (or add it with change_setup first).`);
  }
  // Filters, sorts and form fields must name fields of the table they query.
  for (const m of source.matchAll(/table:\s*["']((?:tbl)_[a-z0-9_]+)["'][^}]*?field:\s*["'](fld_[a-z0-9_]+)["']/g)) {
    const t = bp.tables.find((x) => x.id === m[1]);
    if (t && fields.has(m[2]) && !t.fields.some((f) => f.id === m[2])) errors.add(`Field ${m[2]} isn't on table ${m[1]} (${t.label}).`);
  }
  return [...errors].slice(0, 20);
}
