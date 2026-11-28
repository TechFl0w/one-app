import type { Table } from "@/schema/blueprint";

/**
 * Fields filled from a linked record (field.fill): when a write sets the link, the field takes
 * the linked record's value — unless the same write gives it a value of its own. Picking the
 * "Senior" rate fills the line's price; picking a client fills the job's address.
 */
export async function fillFromLinks(
  table: Table,
  data: Record<string, unknown>,
  load: (tableId: string, id: string) => Promise<Record<string, unknown> | null>,
): Promise<Record<string, unknown>> {
  const out = { ...data };
  for (const f of table.fields) {
    if (!f.fill || f.fill.from in data === false || f.id in data) continue;
    const link = table.fields.find((x) => x.id === f.fill!.from);
    const id = data[f.fill.from];
    const first = Array.isArray(id) ? id[0] : id;
    if (!link || link.type !== "link" || typeof first !== "string") continue;
    const linked = await load(link.to, first).catch(() => null);
    const v = linked?.[f.fill.field];
    if (v !== undefined && v !== null && v !== "") out[f.id] = v;
  }
  return out;
}

/** The same, on raw input before it's checked (so a filled required price passes). */
export async function fillInput(table: Table, input: unknown, load: (tableId: string, id: string) => Promise<Record<string, unknown> | null>): Promise<unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || !table.fields.some((f) => f.fill)) return input;
  return fillFromLinks(table, input as Record<string, unknown>, load);
}
