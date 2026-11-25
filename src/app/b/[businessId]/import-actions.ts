"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { commitChangeSet, getCurrentBlueprint } from "@/server/blueprints";
import { listRecords } from "@/server/records";
import { buildRecords, inferField, MAX_IMPORT_ROWS, type DateOrder, type RowProblem } from "@/import/csv";
import { validateRecordInput, tableOrThrow } from "@/engine/records";
import { recordLabel } from "@/engine/blockData";
import { newId } from "@/engine/editing";
import { GRID_COLUMNS, type Field, type Table } from "@/schema/blueprint";

export interface ImportRequest {
  /** An existing table (with a column → field mapping) or a new table built from the columns. */
  target: { tableId: string; mapping: (string | null)[] } | { newTable: string };
  headers: string[];
  rows: string[][];
  dateOrder: DateOrder;
}
export type ImportResult = { ok: true; imported: number; skipped: number; problems: RowProblem[]; tableId: string; pageId?: string } | { ok: false; error: string };

/**
 * Imports spreadsheet rows as the signed-in user (RLS applies). Rows are validated like any other
 * record; bad rows are reported, not imported. Imports don't trigger automations.
 */
export async function importSpreadsheet(businessId: string, req: ImportRequest): Promise<ImportResult> {
  try {
    if (!Array.isArray(req.rows) || !Array.isArray(req.headers) || req.headers.length > 100) return { ok: false, error: "That file doesn’t look right." };
    if (req.rows.length > MAX_IMPORT_ROWS) return { ok: false, error: `Up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time — split the file.` };
    const rows = req.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").slice(0, 20_000)) : []));
    const dateOrder: DateOrder = req.dateOrder === "dmy" ? "dmy" : "mdy";
    const supabase = await createClient({ source: "import" });
    let bp = await getCurrentBlueprint(supabase, businessId);
    let table: Table;
    let mapping: (string | null)[];
    let pageId: string | undefined;

    if ("newTable" in req.target) {
      // A new table (and page) from the columns, then the rows go into it.
      const label = String(req.target.newTable).trim().slice(0, 80) || "Imported";
      const taken = new Set<string>();
      const fields: Field[] = req.headers.map((h, i) => inferField(h, rows.slice(0, 200).map((r) => r[i] ?? ""), taken, dateOrder));
      const tableId = newId("tbl", label, new Set(bp.tables.map((t) => t.id)));
      const first = fields.find((f) => f.type === "text") ?? fields[0];
      table = { id: tableId, label, fields, ...(first ? { primaryField: first.id } : {}) };
      pageId = newId("pg", label, new Set(bp.pages.map((p) => p.id)));
      const order = Math.max(-1, ...bp.pages.map((p) => p.menuOrder)) + 1;
      const r = await commitChangeSet(supabase, businessId, {
        baseVersion: bp.version,
        source: "ui",
        summary: `Import ${label}`,
        ops: [
          { op: "addTable", table },
          {
            op: "addPage",
            page: {
              id: pageId, label, icon: "table", menuOrder: order, hidden: false,
              layout: { columns: GRID_COLUMNS, blocks: [{ id: `blk_${tableId.slice(4)}_table`.slice(0, 64), type: "table", source: { table: tableId }, x: 0, y: 0, w: GRID_COLUMNS, h: 8, options: { title: label } }] },
            },
          },
        ],
      });
      bp = r.blueprint;
      mapping = fields.map((f) => f.id);
    } else {
      table = tableOrThrow(bp, req.target.tableId);
      mapping = req.target.mapping.map((m) => (typeof m === "string" && table.fields.some((f) => f.id === m) ? m : null));
      if (!mapping.some(Boolean)) return { ok: false, error: "Match at least one column to a field." };
    }

    // Link columns match records of the linked table by their title.
    const linkMaps = new Map<string, Map<string, string>>();
    for (const f of table.fields) {
      if (f.type !== "link" || linkMaps.has(f.to) || !mapping.includes(f.id)) continue;
      const target = tableOrThrow(bp, f.to);
      const m = new Map<string, string>();
      for (let offset = 0; offset < 5000; offset += 500) {
        const page = await listRecords(supabase, businessId, { table: f.to, limit: 500, offset }, bp);
        for (const rec of page.records) m.set(recordLabel(target, rec).trim().toLowerCase(), rec.id);
        if (page.records.length < 500) break;
      }
      linkMaps.set(f.to, m);
    }
    const built = buildRecords(rows, mapping, table, {
      timezone: bp.business.timezone,
      dateOrder,
      linkId: (to, label) => linkMaps.get(to)?.get(label.trim().toLowerCase()),
    });

    // Same validation as every other write; problems are reported per row.
    const valid: Record<string, unknown>[] = [];
    const problems = [...built.problems];
    let skipped = built.skipped;
    built.records.forEach((data, i) => {
      try {
        valid.push(validateRecordInput(table, data, "create"));
      } catch (e) {
        skipped++;
        problems.push({ row: i + 1, field: "", message: e instanceof Error ? e.message : "Invalid" });
      }
    });
    for (let i = 0; i < valid.length; i += 250) {
      const { error } = await supabase.from("records").insert(valid.slice(i, i + 250).map((data) => ({ business_id: businessId, table_id: table.id, data })));
      if (error) return { ok: false, error: `Stopped after ${i} rows: ${error.message}` };
    }
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, imported: valid.length, skipped, problems: problems.slice(0, 50), tableId: table.id, ...(pageId ? { pageId } : {}) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The import failed." };
  }
}
