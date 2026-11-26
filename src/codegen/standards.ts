import type { Blueprint } from "@/schema/blueprint";
import { isIconName, normalizeIconName } from "@/sandbox/iconNames";

/**
 * App rules (docs/app-rules.md) that can be checked in code. `errors` stop a component from
 * being saved; `warnings` go back to the assistant to fix. Also used to list existing screens
 * that don't meet the rules yet.
 */
export function checkStandards(source: string, bp: Blueprint, opts: { inlineForm?: boolean } = {}) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!opts.inlineForm && /<RecordForm\b/.test(source))
    errors.push("Add and edit forms open in a pop-up: use a button that calls openRecordForm({ table, fields, defaults }) instead of RecordForm on the page. Only if the owner asked for the form on the page itself, pass inlineForm: true.");

  // Choices are compared by option id, never by label text (labels can be renamed).
  const labels = new Map<string, string>();
  for (const t of bp.tables) for (const f of t.fields) if ("options" in f && Array.isArray(f.options)) for (const o of f.options) labels.set(o.label.toLowerCase(), o.id);
  for (const m of source.matchAll(/[!=]==?\s*["']([^"'\n]{1,40})["']|["']([^"'\n]{1,40})["']\s*[!=]==?/g)) {
    const text = (m[1] ?? m[2]).toLowerCase();
    const id = labels.get(text);
    if (id) warnings.push(`If this compares a choice, use the option id "${id}", not the label text "${m[1] ?? m[2]}" (labels can be renamed).`);
  }

  // Icons: only the bundled set draws anything.
  const unknown = new Set<string>();
  for (const m of source.matchAll(/<Icon\b[^>]*?\bname=(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g)) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!isIconName(normalizeIconName(name))) unknown.add(name);
  }
  if (unknown.size)
    warnings.push(`Unknown icon ${[...unknown].map((n) => `"${n}"`).join(", ")}: it draws nothing. Use one of the IconName names in "@one/kit" (e.g. "calendar", "user", "dollar-sign").`);

  // Hierarchy: a list of child records shows its parent (a room shows its building).
  const listed = new Set([...source.matchAll(/useRecords\(\s*\{\s*table:\s*["'](tbl_[a-z0-9_]+)["']/g)].map((m) => m[1]));
  for (const tid of listed) {
    const t = bp.tables.find((x) => x.id === tid);
    for (const f of t?.fields ?? []) {
      if (f.type !== "link" || !("to" in f) || !f.to || ("multiple" in f && f.multiple)) continue;
      if (!source.includes(f.id)) {
        const parent = bp.tables.find((x) => x.id === f.to);
        warnings.push(`${t!.label} belong to ${parent?.label ?? f.to} (${f.id}): show it for context — group by it or show it next to each record.`);
      }
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)].slice(0, 5) };
}
