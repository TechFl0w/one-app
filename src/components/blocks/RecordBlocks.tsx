import type { Block, Blueprint, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { groupField, recordLabel, type Group, type LinkLabels } from "@/engine/blockData";
import { FieldValue, formatMoney, valueText, type FormatCtx } from "./format";
import { EditRecordButton, OpenRecord, RecordFile, RecordRowLink } from "./RecordOpener";
import { HeroPhoto, StageStepper } from "./RecordHero";
import { QuickSet } from "./QuickSet";
import { singular } from "@/lib/words";
import { recordPath } from "@/engine/recordPage";
import { DragBoard } from "./DragBoard";
import { NextStepButton } from "./NextStep";
import { COLUMN_COLORS, TONE, toneOf } from "./tone";
import { CoverImage } from "@/components/media/Media";
import { PageIcon } from "@/components/shell/Icon";
import Link from "next/link";

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

/** options.quickSet = { field, buttons: [{ value: option id, label }] }: one-tap buttons in that field's column. */
function quickSetOf(block: Block, table: Table) {
  const q = block.options?.quickSet as { field?: unknown; buttons?: unknown } | undefined;
  const field = table.fields.find((f) => f.id === q?.field);
  if (!field || (field.type !== "status" && field.type !== "choice") || ("derive" in field && field.derive) || !Array.isArray(q?.buttons)) return undefined;
  const buttons = (q.buttons as { value?: unknown; label?: unknown }[])
    .map((b) => field.options.find((o) => o.id === b.value) && { value: String(b.value), label: typeof b.label === "string" ? b.label : field.options.find((o) => o.id === b.value)!.label, color: field.options.find((o) => o.id === b.value)!.color })
    .filter((b): b is { value: string; label: string; color: string | undefined } => !!b)
    .slice(0, 3);
  return buttons.length ? { field, buttons } : undefined;
}

export function TableBlock({ block, table, records, total, labels, ctx }: RecordsProps) {
  const cols = columnsFor(block, table);
  const quick = quickSetOf(block, table);
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
                  {quick && quick.field.id === f.id && !quick.buttons.some((b) => b.value === r.data[f.id]) ? (
                    <QuickSet table={table.id} recordId={r.id} field={f.id} buttons={quick.buttons} current={<FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />} />
                  ) : (
                    <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                  )}
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

/** The photo a card or row leads with: options.cover (a file field), else the table's first file field. */
export function coverField(block: Block, table: Table): Field | undefined {
  if (block.options?.cover === false) return undefined;
  const explicit = table.fields.find((f) => f.id === block.options?.cover && f.type === "file");
  return explicit ?? table.fields.find((f) => f.type === "file");
}

/** Status-like values (badges) go on a row of chips; the rest form a "·" line under the title. */
const isChip = (f: Field) => f.type === "status" || f.type === "choice" || (f.type === "rollup" && f.agg === "latest");

function Facts({ fields, record, labels, ctx }: { fields: Field[]; record: RecordRow; labels: LinkLabels; ctx: FormatCtx }) {
  const has = (f: Field) => record.data[f.id] != null && record.data[f.id] !== "";
  const line = fields.filter((f) => !isChip(f) && has(f));
  const chips = fields.filter((f) => isChip(f) && has(f));
  return (
    <>
      {line.length > 0 && (
        <p className="mt-0.5 truncate text-[13px] text-muted">
          {line.map((f, i) => (
            <span key={f.id}>
              {i > 0 && <span className="mx-1.5 text-muted/50">·</span>}
              <Labelled field={f} />
              <FieldValue field={f} value={record.data[f.id]} labels={labels} ctx={ctx} />
            </span>
          ))}
        </p>
      )}
      {chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((f) => (
            <FieldValue key={f.id} field={f} value={record.data[f.id]} labels={labels} ctx={ctx} />
          ))}
        </div>
      )}
    </>
  );
}

/** Rows with the record's photo (when the table has one), its title, a line of facts and its badges. */
export function ListBlock({ block, table, records, total, labels, ctx }: RecordsProps) {
  if (!records.length) return <Empty>Nothing here right now.</Empty>;
  const cover = coverField(block, table);
  const details = shownFields(block, table, [cover?.id], 3);
  const tone = block.options?.tone ? TONE[toneOf(block.options.tone)] : undefined;
  return (
    <div className="h-full overflow-auto px-3 pb-3">
      <ul className="space-y-2">
        {records.map((r) => (
          <OpenRecord
            as="li"
            key={r.id}
            table={table.id}
            recordId={r.id}
            className="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-ground"
            style={tone ? { background: tone.tint } : { background: "color-mix(in srgb, var(--ground) 55%, transparent)" }}
          >
            {cover && <CoverImage value={r.data[cover.id]} label={recordLabel(table, r, labels)} className="h-16 w-24 shrink-0 rounded-xl sm:h-[76px] sm:w-28" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{recordLabel(table, r, labels)}</p>
              <Facts fields={details} record={r} labels={labels} ctx={ctx} />
            </div>
          </OpenRecord>
        ))}
      </ul>
      <More shown={records.length} total={total} />
    </div>
  );
}

/**
 * Cards in a grid, each led by its photo: products, cars, rooms, styles. options.colorBy (a
 * status, or a rollup of one) fills each card with its colour — a bay map, rooms by occupancy;
 * cards where it's empty show as free spaces.
 */
export function GalleryBlock({ block, table, records, total, labels, ctx }: RecordsProps) {
  if (!records.length) return <Empty>No {table.label.toLowerCase()} yet.</Empty>;
  const colorBy = table.fields.find((f) => f.id === block.options?.colorBy && (f.type === "status" || f.type === "choice"));
  const cover = coverField(block, table);
  const details = shownFields(block, table, [cover?.id, colorBy?.id], 3);
  return (
    <div className="h-full overflow-auto px-5 pb-5">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {records.map((r) => {
          const title = recordLabel(table, r, labels);
          if (colorBy) {
            const v = r.data[colorBy.id];
            const o = colorBy.type === "status" || colorBy.type === "choice" ? colorBy.options.find((x) => x.id === v) : undefined;
            if (!o)
              return (
                <OpenRecord as="li" key={r.id} table={table.id} recordId={r.id} className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-[#CFC6B6] bg-card p-5 text-center">
                  <span className="text-xs font-bold uppercase tracking-widest text-muted">{title}</span>
                  <span className="text-2xl font-extrabold">{typeof block.options?.emptyLabel === "string" ? block.options.emptyLabel : "Free"}</span>
                </OpenRecord>
              );
            const color = o.color ?? "#1F1B14";
            return (
              <OpenRecord as="li" key={r.id} table={table.id} recordId={r.id} className="flex min-h-56 flex-col overflow-hidden rounded-3xl text-white shadow-[0_10px_30px_rgba(31,27,20,.18)]" style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 55%, #1F1B14))` }}>
                <div className="flex items-center justify-between px-5 pt-4">
                  <span className="text-xs font-bold uppercase tracking-widest opacity-80">{title}</span>
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{o.label}</span>
                </div>
                {cover && <CoverImage value={r.data[cover.id]} label={title} className="mx-5 mt-3 h-28 rounded-2xl !bg-none bg-white/10 text-white/50" />}
                <div className="space-y-1 px-5 pb-5 pt-3 text-sm [&_a]:text-white [&_span]:!bg-white/15 [&_span]:!text-white">
                  {details.map((f) =>
                    r.data[f.id] == null || r.data[f.id] === "" ? null : (
                      <p key={f.id} className={`truncate ${f === details[0] ? "text-lg font-extrabold" : "opacity-90"}`}>
                        <FieldValue field={f} value={r.data[f.id]} labels={labels} ctx={ctx} />
                      </p>
                    ),
                  )}
                </div>
              </OpenRecord>
            );
          }
          return (
            <OpenRecord as="li" key={r.id} table={table.id} recordId={r.id} className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft transition hover:-translate-y-0.5 hover:border-accent/40">
              {cover && <CoverImage value={r.data[cover.id]} label={title} className="aspect-[4/3] w-full" />}
              <div className="p-3.5">
                <p className="truncate font-bold">{title}</p>
                <Facts fields={details} record={r} labels={labels} ctx={ctx} />
              </div>
            </OpenRecord>
          );
        })}
      </ul>
      <More shown={records.length} total={total} />
    </div>
  );
}

/**
 * Board columns with a filled, coloured header; cards lead with the record's photo and end with a
 * one-tap "→ next stage" button. Cards can always be dragged between columns too.
 */
export function BoardBlock({ block, table, records, labels, ctx, groups = [] }: RecordsProps & { groups?: Group[] }) {
  const gf = groupField(table, block)!;
  const shownCover = coverField(block, table);
  const details = shownFields(block, table, [gf.id, shownCover?.id], 3);
  const derived = "derive" in gf && !!gf.derive;
  const colored = groups.map((g, i) => ({ ...g, color: g.color ?? COLUMN_COLORS[i % COLUMN_COLORS.length] }));
  const valid = (v: unknown) => typeof v === "string" && colored.some((g) => g.id === v);
  const hasNone = records.some((r) => !valid(r.data[gf.id]));
  const columns: Group[] = [...colored, ...(hasNone ? [{ id: null, label: `No ${gf.label.toLowerCase()}`, color: "#8A8273" }] : [])];
  // A pipeline (options.nextButton: stages run left to right) gets a "→ next stage" button on each card.
  const steps = gf.type === "status" && !derived && block.options?.nextButton === true ? colored.map((g) => g.id!) : undefined;
  const cards = records.map((r) => {
    const v = r.data[gf.id];
    const title = recordLabel(table, r, labels);
    return {
      id: r.id,
      group: valid(v) ? (v as string) : null,
      node: (
        <OpenRecord as="article" table={table.id} recordId={r.id} className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft hover:border-ink/20" style={{ borderTop: "3px solid var(--column, var(--line))" }}>
          {shownCover && <CoverImage value={r.data[shownCover.id]} label={title} className="h-24 w-full" />}
          <div className="p-3">
            <p className="text-[15px] font-bold leading-snug">{title}</p>
            <Facts fields={details} record={r} labels={labels} ctx={ctx} />
            {steps && <NextStepButton recordId={r.id} />}
          </div>
        </OpenRecord>
      ),
    };
  });
  // Drag cards between columns to change their stage; a column field that follows rules can't be set by hand.
  const locked = derived ? `${gf.label} follows the dates, so cards move by themselves.` : undefined;
  return <DragBoard table={table.id} field={gf.id} columns={columns} cards={cards} locked={locked} steps={steps} />;
}

/**
 * A KPI tile: icon, label, big number, a line underneath. `tone` colours it; `alert` makes it
 * stand out only while the number isn't zero (late jobs, low stock). `page` makes it a link.
 */
export function NumberBlock({
  value,
  field,
  agg,
  ctx,
  title,
  options = {},
  href,
}: {
  value: number | null;
  field?: Field;
  agg: string;
  ctx: FormatCtx;
  title?: string;
  options?: Record<string, unknown>;
  href?: string;
}) {
  let text: string;
  if (value === null) text = agg === "count" ? "0" : "—";
  else if (agg !== "count" && field?.type === "money") text = formatMoney(value, field.currency ?? ctx.currency, ctx.locale);
  else if (agg !== "count" && field) text = valueText(field, Math.round(value * 100) / 100, {}, ctx);
  else text = new Intl.NumberFormat(ctx.locale ?? "en-CA").format(value);
  const tone = TONE[toneOf(options.tone)];
  const icon = typeof options.icon === "string" ? options.icon : agg !== "count" && field?.type === "money" ? "money" : undefined;
  const raised = options.alert === true && !!value;
  const sub = typeof options.sub === "string" ? options.sub : typeof options.subtitle === "string" ? options.subtitle : "";
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: raised ? "var(--card)" : tone.tint, color: tone.color }}>
            <PageIcon name={icon} className="h-[18px] w-[18px]" />
          </span>
        )}
        {title && <span className="truncate text-xs font-bold uppercase tracking-wider text-muted">{title}</span>}
      </div>
      <p className="mt-3 text-4xl font-extrabold leading-none tracking-tight tabular-nums" style={{ color: raised || options.alert !== true ? tone.color : undefined }}>
        {text}
      </p>
      {sub && <p className="mt-2 truncate text-[13px] text-muted">{sub}</p>}
    </>
  );
  const cls = "card flex h-full min-h-0 flex-col overflow-hidden px-5 pb-4 pt-4";
  const style = { borderTop: `4px solid ${tone.color}`, ...(raised ? { background: tone.tint, borderColor: tone.color } : {}) };
  return href ? (
    <Link href={href} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-soft`} style={style}>
      {body}
    </Link>
  ) : (
    <section className={cls} style={style}>
      {body}
    </section>
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

/** The status a record moves through in order (a job's stage): options.stepper, else the first status people set with 4+ steps. */
function pipelineField(table: Table, wanted: unknown): (Field & { type: "status" }) | undefined {
  const ok = (f: Field): f is Field & { type: "status" } => f.type === "status" && !("derive" in f && f.derive) && f.options.length >= 3;
  const explicit = table.fields.find((f) => f.id === wanted);
  if (explicit) return ok(explicit) ? explicit : undefined;
  return table.fields.find((f): f is Field & { type: "status" } => ok(f) && f.options.length >= 4);
}

/**
 * A record page's details. options.part picks a piece: "hero" (photo, title, where it belongs,
 * badges, stage stepper), "facts" (the other fields), "photos" (its photo and video fields, add
 * straight in). Without part, all three in one card.
 */
export function DetailsBlock({ table, record, labels, ctx, basePath, options = {} }: { table: Table; record: RecordRow; labels: LinkLabels; ctx: FormatCtx; blueprint?: Blueprint; basePath?: string; options?: Record<string, unknown> }) {
  const part = options.part === "hero" || options.part === "facts" || options.part === "photos" ? options.part : undefined;
  const title = table.fields.find((f) => f.id === table.primaryField) ?? table.fields.find((f) => f.type === "text");
  const titleText = title ? (title.type === "link" ? labels[String(record.data[title.id])] ?? "—" : valueText(title, record.data[title.id], labels, ctx) || "Untitled") : "Untitled";
  const files = table.fields.filter((f) => f.type === "file");
  const cover = files.find((f) => record.data[f.id] != null && (!Array.isArray(record.data[f.id]) || (record.data[f.id] as unknown[]).length > 0)) ?? files[0];
  const pipeline = pipelineField(table, options.stepper);
  const chips = table.fields.filter((f) => isChip(f) && f.id !== title?.id && f.id !== pipeline?.id && record.data[f.id] != null && record.data[f.id] !== "");
  const links = table.fields.filter((f) => f.type === "link" && f.id !== title?.id && record.data[f.id]).slice(0, 3);
  // Next to a hero, facts skip what the hero already shows and what's still empty.
  const facts = table.fields.filter(
    (f) => f.id !== title?.id && !files.includes(f) && !isChip(f) && f.id !== pipeline?.id && (part !== "facts" || (!links.includes(f) && record.data[f.id] != null && record.data[f.id] !== "")),
  );
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

  const hero = (
    <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
      {cover && <HeroPhoto value={record.data[cover.id]} label={titleText} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              <span className="font-semibold uppercase tracking-wider">{singular(table.label)}</span>
              {links.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-2">
                  <span className="text-muted/50">·</span>
                  {value(f)}
                </span>
              ))}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight md:text-[28px]">{titleText}</h1>
          </div>
          <EditRecordButton table={table.id} recordId={record.id} label={`Edit ${singular(table.label).toLowerCase()}`} />
        </div>
        {chips.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chips.map((f) => (
              <span key={f.id} title={f.label}>
                <FieldValue field={f} value={record.data[f.id]} labels={labels} ctx={ctx} />
              </span>
            ))}
          </div>
        )}
        {pipeline && (
          <StageStepper
            table={table.id}
            recordId={record.id}
            field={pipeline.id}
            label={pipeline.label}
            value={typeof record.data[pipeline.id] === "string" ? (record.data[pipeline.id] as string) : null}
            steps={pipeline.options.map((o, i) => ({ id: o.id, label: o.label, color: o.color ?? COLUMN_COLORS[i % COLUMN_COLORS.length] }))}
          />
        )}
      </div>
    </div>
  );
  const factList = (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {facts.map((f) => (
        <div key={f.id} className={`min-w-0 ${f.type === "long_text" || part === "facts" ? "sm:col-span-2" : ""} ${part === "facts" && f.type !== "long_text" ? "flex items-baseline justify-between gap-4 border-b border-line/60 pb-2" : ""}`}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className={`mt-0.5 text-sm ${f.type === "long_text" ? "whitespace-pre-wrap" : "truncate"} ${part === "facts" && f.type !== "long_text" ? "text-right font-medium" : ""}`}>{value(f)}</dd>
        </div>
      ))}
    </dl>
  );
  const photos = files.map((f) => <RecordFile key={f.id} table={table.id} recordId={record.id} field={f.id} file={record.data[f.id]} label={f.label} multiple={"multiple" in f && !!f.multiple} />);

  if (part === "hero") return <section className="card h-full overflow-hidden">{hero}</section>;
  if (part === "facts")
    return (
      <section className="card flex h-full flex-col overflow-hidden">
        <h2 className="px-5 pb-2 pt-4 text-sm font-semibold">{typeof options.title === "string" ? options.title : "Details"}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{factList}</div>
      </section>
    );
  if (part === "photos")
    return (
      <section className="card flex h-full flex-col overflow-hidden">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">{photos.length ? photos : <p className="text-sm text-muted">{table.label} have no photo field yet.</p>}</div>
      </section>
    );
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-line">{hero}</div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {files.length > 1 || (files.length === 1 && files[0] !== cover) || files.some((f) => "multiple" in f && f.multiple) ? <div className="mb-5 flex flex-col gap-4">{photos}</div> : null}
        {files.length === 1 && !("multiple" in files[0] && files[0].multiple) && !record.data[files[0].id] && <div className="mb-5">{photos}</div>}
        {factList}
      </div>
    </div>
  );
}
