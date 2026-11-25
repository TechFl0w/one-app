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

/**
 * Ids a change would pull out from under existing screens: used in a component's code, present
 * before the change, gone after it. Changes like that are refused, so an update never breaks a
 * screen that's live.
 */
export function brokenByChange(before: Blueprint, after: Blueprint): { component: string; ids: string[] }[] {
  const ids = (bp: Blueprint) =>
    new Set([
      ...bp.tables.map((t) => t.id),
      ...bp.tables.flatMap((t) => t.fields.map((f) => f.id)),
      ...bp.tables.flatMap((t) => t.fields.flatMap((f) => ("options" in f && Array.isArray(f.options) ? f.options.map((o) => o.id) : []))),
      ...bp.pages.map((p) => p.id),
    ]);
  const had = ids(before);
  const has = ids(after);
  const out: { component: string; ids: string[] }[] = [];
  for (const c of after.components ?? []) {
    const used = usedIds(c.source);
    const gone = [...used].filter((id) => had.has(id) && !has.has(id));
    if (gone.length) out.push({ component: c.label, ids: gone });
  }
  return out;
}

/** A readable name for an id in a blueprint ("field “Status” of Rooms"). */
export function describeId(bp: Blueprint, id: string): string {
  const t = bp.tables.find((x) => x.id === id);
  if (t) return `the ${t.label} table`;
  for (const tb of bp.tables)
    for (const f of tb.fields) {
      if (f.id === id) return `the “${f.label}” field of ${tb.label}`;
      const o = "options" in f && Array.isArray(f.options) ? f.options.find((x) => x.id === id) : undefined;
      if (o) return `the “${o.label}” choice of ${f.label}`;
    }
  const p = bp.pages.find((x) => x.id === id);
  return p ? `the ${p.label} page` : id;
}

/** Table, field, option and page ids written as whole string literals in a component's code. */
export function usedIds(source: string): string[] {
  return [...new Set([...source.matchAll(/["'`]((?:tbl|fld|opt|pg)_[a-z0-9_]{1,60})["'`]/g)].map((m) => m[1]))];
}
