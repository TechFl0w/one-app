import type { Blueprint } from "@/schema/blueprint";
import { auditLine, type AuditRow } from "@/engine/auditText";
import { formatDateTime, valueText, type FormatCtx } from "./format";
import { singular } from "@/lib/words";
import { Empty } from "./RecordBlocks";

/** A record's timeline: stage moves, approvals, payments added — newest first. */
export function ActivityBlock({ rows, blueprint, tableId, recordId, ctx }: { rows: AuditRow[]; blueprint: Blueprint; tableId: string; recordId: string; ctx: FormatCtx }) {
  if (!rows.length) return <Empty>Nothing has happened yet.</Empty>;
  const fmt = (f: Parameters<typeof valueText>[0], v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" && !Array.isArray(v) ? "a file" : valueText(f, v, {}, ctx));
  return (
    <ol className="h-full space-y-3 overflow-y-auto px-5 pb-5">
      {rows.map((row) => {
        const line = auditLine(blueprint, row, undefined, fmt);
        const own = row.record_id === recordId && row.table_id === tableId;
        const table = blueprint.tables.find((t) => t.id === row.table_id);
        const status = line.changes.find((c) => table?.fields.find((f) => f.label === c.field && (f.type === "status" || f.type === "choice")));
        const opt = status && table?.fields.flatMap((f) => (f.label === status.field && "options" in f ? f.options : [])).find((o) => o.label === status.after);
        const title = line.changes.length ? line.changes.slice(0, 3).map((c) => `${c.field} → ${c.after}`).join(", ") : line.what[0].toUpperCase() + line.what.slice(1);
        return (
          <li key={row.id} className="flex gap-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: opt?.color ?? (row.action === "record.created" ? "var(--accent)" : "var(--muted)") }} />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{title}</p>
              <p className="text-xs text-muted">
                {!own && table && line.changes.length > 0 ? `${singular(table.label)} · ` : ""}
                {line.who} · {formatDateTime(row.created_at, ctx)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
