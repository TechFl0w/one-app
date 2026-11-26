import type { Block, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { groupField, recordLabel, type Group, type LinkLabels } from "@/engine/blockData";
import { FieldValue, formatMoney, valueText, type FormatCtx } from "./format";
import { OpenRecord, RecordRowLink } from "./RecordOpener";

type RecordsProps = {
  block: Block;
  table: Table;
  records: RecordRow[];
  total: number;
  labels: LinkLabels;
  ctx: FormatCtx;
};

const strings = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

/** Columns for a table block: options.columns, else every field except long text. */
function columnsFor(block: Block, table: Table): Field[] {
  const wanted = strings(block.options?.columns);
  if (wanted) return wanted.map((id) => table.fields.find((f) => f.id === id)).filter((f): f is Field => !!f);
  return table.fields.filter((f) => f.type !== "long_text").slice(0, 8);
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-16 items-center justify-center px-5 pb-5 text-center text-sm text-muted">{children}</div>;
}

function More({ shown, total }: { shown: number; total: number }) {
  if (total <= shown) return null;
  return <p className="px-5 py-2 text-xs text-muted">Showing {shown} of {total}</p>;
}

export function TableBlock({ block, table, records, total, labels, ctx }: RecordsProps) {
  const cols = columnsFor(block, table);
  if (!records.length) return <Empty>No {table.label.toLowerCase()} yet.</Empty>;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            {cols.map((f) => (
              <th key={f.id} scope="col" className="border-b border-line px-5 py-2 text-left text-xs font-medium text-muted first:pl-5">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <RecordRowLink key={r.id} table={table.id} recordId={r.id}>
              {cols.map((f, i) => (
                <td key={f.id} className={`border-b border-line/60 px-5 py-2.5 ${i === 0 ? "font-medium" : ""}`}>
                  <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                </td>
              ))}
            </RecordRowLink>
          ))}
        </tbody>
      </table>
      <More shown={records.length} total={total} />
    </div>
  );
}

/** Secondary fields shown under a record's title in lists and cards. */
function detailFields(table: Table, exclude: (string | undefined)[], max: number): Field[] {
  const primary = table.fields.find((f) => f.id === table.primaryField) ?? table.fields.find((f) => f.type === "text");
  const skip = new Set([primary?.id, ...exclude]);
  const rank = (f: Field) => (f.type === "datetime" || f.type === "date" ? 0 : f.type === "status" ? 1 : f.type === "long_text" ? 9 : 2);
  return table.fields.filter((f) => !skip.has(f.id) && f.type !== "formula" && f.type !== "rollup").sort((a, b) => rank(a) - rank(b)).slice(0, max);
}

export function ListBlock({ table, records, total, labels, ctx }: RecordsProps) {
  if (!records.length) return <Empty>Nothing here right now.</Empty>;
  const details = detailFields(table, [], 3);
  return (
    <div className="h-full overflow-auto">
      <ul className="divide-y divide-line/60">
        {records.map((r) => (
          <OpenRecord as="li" key={r.id} table={table.id} recordId={r.id} className="px-5 py-3 hover:bg-ground/60">
            <p className="truncate text-sm font-semibold">{recordLabel(table, r, labels)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {details.map((f) =>
                r.data[f.id] == null || r.data[f.id] === "" ? null : (
                  <span key={f.id} className="max-w-full truncate">
                    <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                  </span>
                ),
              )}
            </div>
          </OpenRecord>
        ))}
      </ul>
      <More shown={records.length} total={total} />
    </div>
  );
}

export function BoardBlock({ block, table, records, labels, ctx, groups = [] }: RecordsProps & { groups?: Group[] }) {
  const gf = groupField(table, block)!;
  const details = detailFields(table, [gf.id], 2);
  const byGroup = new Map<string | null, RecordRow[]>();
  for (const r of records) {
    const v = r.data[gf.id];
    const key = typeof v === "string" && groups.some((g) => g.id === v) ? v : null;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const columns: Group[] = [...groups, ...(byGroup.has(null) ? [{ id: null, label: `No ${gf.label.toLowerCase()}` }] : [])];

  return (
    <div className="flex h-full gap-3 overflow-x-auto px-5 pb-5">
      {columns.map((g) => {
        const items = byGroup.get(g.id) ?? [];
        return (
          <div key={g.id ?? "_none"} className="flex w-64 shrink-0 flex-col rounded-2xl bg-ground p-2">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: g.color ?? "var(--muted)" }} />
              <span className="truncate text-sm font-semibold">{g.label}</span>
              <span className="ml-auto text-xs text-muted">{items.length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-0.5">
              {items.map((r) => (
                <OpenRecord as="article" key={r.id} table={table.id} recordId={r.id} className="rounded-xl border border-line bg-card p-3 shadow-soft hover:border-accent/40">
                  <p className="truncate text-sm font-semibold">{recordLabel(table, r, labels)}</p>
                  <div className="mt-1.5 space-y-1 text-xs text-muted">
                    {details.map((f) =>
                      r.data[f.id] == null ? null : (
                        <div key={f.id} className="truncate">
                          <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                        </div>
                      ),
                    )}
                  </div>
                </OpenRecord>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NumberBlock({
  value,
  field,
  agg,
  ctx,
}: {
  value: number | null;
  field?: Field;
  agg: string;
  ctx: FormatCtx;
}) {
  let text: string;
  if (value === null) text = agg === "count" ? "0" : "—";
  else if (agg !== "count" && field?.type === "money") text = formatMoney(value, field.currency ?? ctx.currency, ctx.locale);
  else if (agg !== "count" && field) text = valueText(field, Math.round(value * 100) / 100, {}, ctx);
  else text = new Intl.NumberFormat(ctx.locale ?? "en-CA").format(value);
  return (
    <div className="flex h-full items-end px-5 pb-4">
      <p className="text-3xl font-bold tabular-nums tracking-tight">{text}</p>
    </div>
  );
}

export function NotesBlock({ block }: { block: Block }) {
  const text = typeof block.options?.text === "string" ? block.options.text : "";
  return (
    <div className="h-full overflow-auto whitespace-pre-wrap px-5 pb-5 text-sm leading-relaxed text-muted">
      {text || "Empty note."}
    </div>
  );
}
