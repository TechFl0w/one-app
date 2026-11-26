import type { Block, Blueprint, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { groupField, recordLabel, type Group, type LinkLabels } from "@/engine/blockData";
import { FieldValue, formatMoney, valueText, type FormatCtx } from "./format";
import { EditRecordButton, OpenRecord, RecordFile, RecordRowLink } from "./RecordOpener";
import { recordPath } from "@/engine/recordPage";
import { DragBoard } from "./DragBoard";

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

/** Numbers and amounts say what they are ("In stock 3", "Balance $305"); names, badges and dates speak for themselves. */
function Labelled({ field }: { field: Field }) {
  const numeric = field.type === "number" || field.type === "money" || field.type === "formula" || (field.type === "rollup" && field.agg !== "latest");
  return numeric ? <span className="mr-1 text-muted/70">{field.label}</span> : null;
}

/** Fields a list item or card shows under its title: options.fields, else a sensible few. */
function shownFields(block: Block, table: Table, exclude: (string | undefined)[], max: number): Field[] {
  const wanted = strings(block.options?.fields);
  if (wanted) return wanted.map((id) => table.fields.find((f) => f.id === id)).filter((f): f is Field => !!f && !exclude.includes(f.id));
  return detailFields(table, exclude, max);
}

export function ListBlock({ block, table, records, total, labels, ctx }: RecordsProps) {
  if (!records.length) return <Empty>Nothing here right now.</Empty>;
  const details = shownFields(block, table, [], 3);
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
                    <Labelled field={f} />
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
  const details = shownFields(block, table, [gf.id], 2);
  const byGroup = new Map<string | null, RecordRow[]>();
  for (const r of records) {
    const v = r.data[gf.id];
    const key = typeof v === "string" && groups.some((g) => g.id === v) ? v : null;
    byGroup.set(key, [...(byGroup.get(key) ?? []), r]);
  }
  const columns: Group[] = [...groups, ...(byGroup.has(null) ? [{ id: null, label: `No ${gf.label.toLowerCase()}` }] : [])];
  const cards = records.map((r) => {
    const v = r.data[gf.id];
    return {
      id: r.id,
      group: typeof v === "string" && groups.some((g) => g.id === v) ? v : null,
      node: (
        <OpenRecord as="article" table={table.id} recordId={r.id} className="rounded-xl border border-line bg-card p-3 shadow-soft hover:border-accent/40">
          <p className="truncate text-sm font-semibold">{recordLabel(table, r, labels)}</p>
          <div className="mt-1.5 space-y-1 text-xs text-muted">
            {details.map((f) =>
              r.data[f.id] == null ? null : (
                <div key={f.id} className="truncate">
                  <Labelled field={f} />
                  <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                </div>
              ),
            )}
          </div>
        </OpenRecord>
      ),
    };
  });
  // Drag cards between columns to change their stage; a column field that follows rules can't be set by hand.
  const locked = "derive" in gf && gf.derive ? `${gf.label} follows the dates, so cards move by themselves.` : undefined;
  return <DragBoard table={table.id} field={gf.id} columns={columns} cards={cards} locked={locked} />;
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

/**
 * A record page's details: every field of the record (computed ones too), links go to the
 * linked record's page, photos show as pictures. Edit opens the record's form.
 */
export function DetailsBlock({ table, record, labels, ctx, basePath }: { table: Table; record: RecordRow; labels: LinkLabels; ctx: FormatCtx; blueprint?: Blueprint; basePath?: string }) {
  const title = table.fields.find((f) => f.id === table.primaryField) ?? table.fields.find((f) => f.type === "text");
  const status = table.fields.filter((f) => f.type === "status" && f.id !== title?.id);
  const files = table.fields.filter((f) => f.type === "file");
  const rest = table.fields.filter((f) => f.id !== title?.id && !status.includes(f) && !files.includes(f) && f.type !== "hours");
  const value = (f: Field) => {
    const v = record.data[f.id];
    if (f.type === "link" && basePath && v) {
      const ids = (Array.isArray(v) ? v : [v]).map(String);
      return (
        <span className="inline-flex flex-wrap gap-x-2">
          {ids.map((id) => (
            <a key={id} href={recordPath(basePath, f.to, id)} className="font-medium text-accent hover:underline">
              {labels[id] ?? "—"}
            </a>
          ))}
        </span>
      );
    }
    return <FieldValue field={f} value={v} labels={labels} ctx={ctx} />;
  };
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">{table.label.replace(/s$/, "")}</p>
          <h2 className="truncate text-xl font-bold tracking-tight">{title ? (title.type === "link" ? labels[String(record.data[title.id])] ?? "—" : valueText(title, record.data[title.id], labels, ctx) || "Untitled") : "Untitled"}</h2>
          {status.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {status.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1.5 text-xs text-muted">
                  {f.label} <FieldValue field={f} value={record.data[f.id]} labels={labels} ctx={ctx} />
                </span>
              ))}
            </div>
          )}
        </div>
        <EditRecordButton table={table.id} recordId={record.id} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {files.some((f) => record.data[f.id]) && (
          <div className="mb-4 flex flex-wrap gap-3">
            {files.map((f) => (record.data[f.id] ? <RecordFile key={f.id} file={record.data[f.id]} label={f.label} /> : null))}
          </div>
        )}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {rest.map((f) => (
            <div key={f.id} className={`min-w-0 ${f.type === "long_text" ? "sm:col-span-2" : ""}`}>
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className={`mt-0.5 text-sm ${f.type === "long_text" ? "whitespace-pre-wrap" : "truncate"}`}>{value(f)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
