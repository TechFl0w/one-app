import type { Blueprint } from "@/schema/blueprint";

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

  // Hierarchy: a list of child records shows its parent (a room shows its building).
  const listed = listedTables(source);
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
  // Every add form can actually be completed: required fields are in the form or prefilled.
  for (const m of source.matchAll(/openRecordForm\(\s*\{/g)) {
    const call = formCall(source, m.index! + m[0].length - 1);
    const tid = /\btable:\s*["'](tbl_[a-z0-9_]+)["']/.exec(call)?.[1];
    const fieldList = /\bfields:\s*\[([^\]]*)\]/.exec(call)?.[1];
    if (!tid || fieldList === undefined || /\brecordId\b/.test(call)) continue;
    const t = bp.tables.find((x) => x.id === tid);
    const defaults = /\bdefaults:\s*\{([\s\S]*)\}/.exec(call)?.[1] ?? "";
    for (const f of t?.fields ?? []) {
      if (!f.required || fieldList.includes(f.id) || defaults.includes(f.id)) continue;
      errors.push(`The add form for ${t!.label} leaves out ${f.label} (${f.id}), which is required, so the owner can never save it. Add it to fields (or prefill it in defaults).`);
    }
  }

  // Files the owner adds are shown: a photo field on a listed table appears on the screen.
  for (const tid of listed) {
    const t = bp.tables.find((x) => x.id === tid);
    for (const f of t?.fields ?? []) {
      if (f.type === "file" && !source.includes(f.id))
        warnings.push(`${t!.label} have ${f.label} (${f.id}) but this screen never shows it: show it with FileImage (thumbnails in lists and cards, bigger in details; other files open on click).`);
    }
  }
  const fileIds = bp.tables.flatMap((t) => t.fields.filter((f) => f.type === "file").map((f) => f.id)).filter((id) => source.includes(id));
  if (fileIds.length && /<img\b|href=\{/.test(source) && !/FileImage|useFileUrl|openFile/.test(source))
    errors.push("Files have no web address a screen can use: show photos with FileImage (or useFileUrl) and open other files with openFile — not <img src> or links built from the file value.");
  if (/<input[^>]*type=["']file["']/.test(source) && !/uploadFile\(/.test(source))
    errors.push("A file input on its own uploads nothing: use FileInput (or uploadFile) so the file is stored, or let openRecordForm handle it.");

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)].slice(0, 5) };
}

/** The text of one openRecordForm({ … }) argument, from its opening brace to the matching close. */
function formCall(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length && i < open + 4000; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open, open + 4000);
}

/**
 * Tables whose records a screen actually lists. Tables loaded only to look things up (a payment
 * showing its room's name) don't count, so the parent/photo rules don't ask for clutter.
 * `const x = useRecords({ table })` counts when x.records is mapped or filtered;
 * destructured `const { records } = useRecords(...)` and table constants always count.
 */
function listedTables(source: string): Set<string> {
  const out = new Set<string>();
  const consts = new Map([...source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*["'](tbl_[a-z0-9_]+)["']/g)].map((m) => [m[1], m[2]]));
  for (const m of source.matchAll(/(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?useRecords\(\s*\{\s*table:\s*(?:["'](tbl_[a-z0-9_]+)["']|([A-Za-z_$][\w$]*))/g)) {
    const table = m[2] ?? consts.get(m[3] ?? "");
    if (!table) continue;
    const v = m[1];
    if (!v || new RegExp(`\\b${v.replace(/\$/g, "\\$")}\\.records\\s*\\.\\s*(map|filter|flatMap|forEach|slice|sort)\\(`).test(source)) out.add(table);
  }
  return out;
}
