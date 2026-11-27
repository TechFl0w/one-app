import type { Block, Blueprint, Field, Page, Table } from "@/schema/blueprint";

/**
 * Record pages: every record has its own page (/r/<table>/<record>) with its details and
 * everything linked to it — a car's jobs, a job's lines and payments, a customer's cars. A table
 * gets a designed page when one exists (page.recordOf), else this default one, so every app built
 * on One App has them from the start.
 */

/** The filter value that means "the record this page is about". */
export const RECORD_TOKEN = "@record";

export const recordPath = (basePath: string, tableId: string, recordId: string) => `${basePath}/r/${tableId}/${recordId}`;

/** Whether clicking a record of this table opens its page (default) or a quick edit pop-up. */
export const opensAsPage = (bp: Blueprint, tableId: string) => bp.tables.find((t) => t.id === tableId)?.openIn !== "modal";

/** Links from other tables to this one: each becomes a related list on the record page. */
export function relatedLinks(bp: Blueprint, tableId: string): { table: Table; field: Field }[] {
  return bp.tables.flatMap((t) => t.fields.filter((f) => f.type === "link" && f.to === tableId).map((field) => ({ table: t, field })));
}

/** The designed record page for a table, or the default one (not stored; not editable as is). */
export function recordPageFor(bp: Blueprint, tableId: string): { page: Page; designed: boolean } | null {
  const table = bp.tables.find((t) => t.id === tableId);
  if (!table) return null;
  const designed = bp.pages.find((p) => p.recordOf === tableId);
  if (designed) return { page: designed, designed: true };
  return { page: { id: `pg_record_${tableId.slice(4)}`.slice(0, 63), label: table.label, menuOrder: 0, hidden: true, recordOf: tableId, layout: { columns: 12, blocks: defaultRecordBlocks(bp, tableId) } }, designed: false };
}

/** Details on the left, a list for each kind of linked record on the right. */
export function defaultRecordBlocks(bp: Blueprint, tableId: string): Block[] {
  const table = bp.tables.find((t) => t.id === tableId);
  if (!table) return [];
  const related = relatedLinks(bp, tableId);
  const fieldRows = Math.ceil(table.fields.length / 2);
  const details: Block = { id: "blk_record_details", type: "details", x: 0, y: 0, w: related.length ? 5 : 12, h: Math.min(12, Math.max(4, fieldRows + 1)), source: { table: tableId } };
  const sameTable = (t: Table) => related.filter((r) => r.table.id === t.id).length > 1;
  let y = 0;
  const lists = related.map(({ table: t, field }, i): Block => {
    const date = t.fields.find((f) => f.type === "datetime") ?? t.fields.find((f) => f.type === "date");
    const columns = t.fields.filter((f) => f.id !== field.id && f.type !== "long_text" && f.type !== "file").slice(0, 6).map((f) => f.id);
    const block: Block = {
      id: `blk_record_rel_${i}`,
      type: "table",
      x: 5,
      y,
      w: 7,
      h: 4,
      // A link that holds several records (a service's stylists) contains this one.
      source: { table: t.id, filters: [{ field: field.id, op: "multiple" in field && field.multiple ? "contains" : "eq", value: RECORD_TOKEN }], sort: [{ field: date?.id ?? "_created_at", dir: "desc" }] },
      options: { title: sameTable(t) ? `${t.label} (${field.label})` : t.label, columns },
    };
    y += 4;
    return block;
  });
  return [details, ...lists];
}

/** Values a new record gets when added from a list scoped to a record (its link back to it). */
export function recordDefaults(filters: { field: string; op: string; value?: unknown }[] | undefined, recordId: string | undefined): Record<string, string | string[]> {
  if (!recordId) return {};
  return Object.fromEntries(
    (filters ?? []).filter((f) => (f.op === "eq" || f.op === "contains") && f.value === RECORD_TOKEN).map((f) => [f.field, f.op === "contains" ? [recordId] : recordId]),
  );
}
