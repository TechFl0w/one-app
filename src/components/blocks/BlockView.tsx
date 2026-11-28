import type { Block, Blueprint, Table } from "@/schema/blueprint";
import type { RecordStore } from "@/engine/store";
import { loadBlockData, recordLabel } from "@/engine/blockData";
import { blockQuery, DATE_FILTERS, filterableFields, matchingLinks, type Params } from "@/engine/search";
import { buildRecordQuery } from "@/engine/records";
import { BlockSearch, type FilterField } from "./BlockSearch";
import { BlockFrame } from "./BlockFrame";
import { BoardBlock, DetailsBlock, Empty, GalleryBlock, ListBlock, NotesBlock, NumberBlock, TableBlock } from "./RecordBlocks";
import { displayTable } from "@/engine/blockData";
import { recordDefaults } from "@/engine/recordPage";
import { AddRecordButton } from "./RecordOpener";
import { CalendarBlock } from "./CalendarBlock";
import { HeaderBlock } from "./HeaderBlock";
import { ActivityBlock } from "./ActivityBlock";
import { DocumentView } from "@/components/documents/DocumentView";
import { DocumentActions } from "@/components/documents/DocumentActions";
import { FormBlock, type FormAction } from "./FormBlock";
import type { FormatCtx } from "./format";
import { SandboxFrame } from "@/components/sandbox/SandboxFrame";
import { sandboxSchema } from "@/sandbox/schema";
import type { SandboxBridge } from "@/sandbox/protocol";

/** Title shown on a block: options.title, else the source table's label, else the block type. */
export function blockTitle(block: Block, blueprint: Blueprint): string {
  const t = block.options?.title;
  if (typeof t === "string" && t.trim()) return t;
  const table = block.source && blueprint.tables.find((x) => x.id === block.source!.table);
  return table?.label ?? block.type[0].toUpperCase() + block.type.slice(1);
}

export interface BlockEnv {
  blueprint: Blueprint;
  store: RecordStore;
  /** Server action for a form block, bound to its table and fields. */
  formAction: (tableId: string, fields: string[] | undefined) => FormAction;
  now?: Date;
  /** Data access for generated components (server actions) and where the app's pages live. */
  sandbox?: { bridge: SandboxBridge; basePath: string };
  /** On a record page: the record the page is about. */
  recordId?: string;
  /** The page address's query (search boxes and filters of tables and lists). */
  params?: Params;
  /** Online payments: ready, or not yet connected (then invoices offer to connect Stripe). */
  payments?: { ready: boolean; settingsHref: string };
}

/** The filters a block offers, with their choices in plain words. */
async function filterOptions(bp: Blueprint, store: BlockEnv["store"], table: Table, block: Block, now?: Date): Promise<FilterField[]> {
  // A board already splits by its column field; filters on the block's own fixed filters are left out.
  const fixed = new Set((block.source?.filters ?? []).map((f) => f.field));
  const out: FilterField[] = [];
  for (const f of filterableFields(table)) {
    if (fixed.has(f.id) || (block.type === "board" && block.source?.groupBy === f.id)) continue;
    if (f.type === "status" || f.type === "choice") out.push({ id: f.id, label: f.label, options: f.options.map((o) => ({ value: o.id, label: o.label })) });
    else if (f.type === "checkbox") out.push({ id: f.id, label: f.label, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] });
    else if (f.type === "date" || f.type === "datetime") out.push({ id: f.id, label: f.label, options: Object.entries(DATE_FILTERS).map(([value, d]) => ({ value, label: d.label })) });
    else if (f.type === "link") {
      const target = bp.tables.find((t) => t.id === f.to);
      if (!target) continue;
      const { records, total } = await store.query(buildRecordQuery(bp, { table: target.id, limit: 25 }, { now })).catch(() => ({ records: [], total: 0 }));
      // Only short lists (staff, bays, categories) make sense as filter buttons; search covers the rest.
      if (total > 0 && total <= 25) out.push({ id: f.id, label: f.label, options: records.map((r) => ({ value: r.id, label: recordLabel(target, r) })) });
    }
  }
  return out.slice(0, 8);
}

export async function BlockView({ block, env, fullPage = false }: { block: Block; env: BlockEnv; fullPage?: boolean }) {
  const { blueprint, store, now } = env;
  const ctx: FormatCtx = { timezone: blueprint.business.timezone, currency: blueprint.business.currency ?? process.env.DEFAULT_CURRENCY ?? "CAD" };
  const title = blockTitle(block, blueprint);

  if (block.type === "custom") {
    const component = blueprint.components?.find((c) => c.id === block.options?.component);
    if (!component || !env.sandbox) {
      return (
        <BlockFrame title={title}>
          <Empty>{component ? "Custom parts can’t be shown here." : "This custom part was removed."}</Empty>
        </BlockFrame>
      );
    }
    const props = { ...(block.options?.props && typeof block.options.props === "object" ? (block.options.props as Record<string, unknown>) : {}), ...(env.recordId ? { recordId: env.recordId } : {}) };
    return (
      // Sized to its content: outside Edit mode the page lets rows shrink and grow around it.
      <div className={fullPage ? "" : "h-full overflow-hidden rounded-card"}>
        <SandboxFrame
          title={component.label}
          componentId={component.id}
          theme={blueprint.theme}
          compiled={component.compiled} css={component.css}
          props={props}
          schema={sandboxSchema(blueprint)}
          bridge={env.sandbox.bridge}
          basePath={env.sandbox.basePath}
          autoHeight
        />
      </div>
    );
  }
  // Tables and lists get a search box and filters (in the page address).
  const searchable = ["table", "list", "gallery", "board"].includes(block.type) && block.source ? blueprint.tables.find((t) => t.id === block.source!.table) : undefined;
  const asked = searchable ? blockQuery(searchable, block.id, env.params) : undefined;
  const links = asked?.q ? await matchingLinks(blueprint, store, searchable!, asked.q, { now }).catch(() => []) : [];
  const extra = asked && (asked.q || asked.filters.length) ? { filters: asked.filters, ...(asked.q ? { search: { q: asked.q, links } } : {}) } : undefined;
  const data = await loadBlockData(block, blueprint, store, { now, recordId: env.recordId, ...(extra ? { extra } : {}) });

  switch (data.kind) {
    case "error":
      return (
        <BlockFrame title={title}>
          <Empty>{data.message}</Empty>
        </BlockFrame>
      );
    case "unsupported":
      return (
        <BlockFrame title={title}>
          <Empty>{block.type[0].toUpperCase() + block.type.slice(1)} blocks are coming soon.</Empty>
        </BlockFrame>
      );
    case "static":
      return (
        <BlockFrame title={title}>
          <NotesBlock block={block} />
        </BlockFrame>
      );
    case "number": {
      const target = typeof block.options?.page === "string" ? blueprint.pages.find((p) => p.id === block.options!.page) : undefined;
      return <NumberBlock value={data.value} field={data.field} agg={block.source?.agg ?? "count"} ctx={ctx} title={title} options={block.options} href={target && env.sandbox ? `${env.sandbox.basePath}/p/${target.id}` : undefined} />;
    }
    case "document":
      return (
        <section className="card flex h-full flex-col gap-4 overflow-hidden p-4 md:p-6">
          <DocumentActions table={block.source!.table} recordId={env.recordId!} kind={data.view.kind} label={data.view.label} sent={data.view.state !== "draft"} canInvoice={data.canInvoice} invoice={data.invoice} />
          {data.view.kind === "invoice" && env.payments && !env.payments.ready && data.view.state !== "paid" && (
            <a href={env.payments.settingsHref} className="no-print flex items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:underline">
              <span className="font-semibold">Connect Stripe to get paid online.</span> Until then {data.view.customer.name || "your client"} can’t pay this invoice from the link.
            </a>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-line p-5 md:p-8">
            <DocumentView doc={data.view} />
          </div>
        </section>
      );
    case "activity":
      return (
        <BlockFrame title={typeof block.options?.title === "string" ? block.options.title : "Activity"}>
          <ActivityBlock rows={data.rows} blueprint={blueprint} tableId={block.source!.table} recordId={env.recordId!} ctx={ctx} />
        </BlockFrame>
      );
    case "header":
      return (
        <HeaderBlock
          block={block}
          blueprint={blueprint}
          stats={data.stats}
          ctx={ctx}
          now={now}
          // Real businesses only (the demo has no settings): the owner's booking link lives in Settings › Booking.
          bookingHref={blueprint.scheduling && env.sandbox?.basePath?.startsWith("/b/") ? `${env.sandbox.basePath}/settings/booking` : undefined}
        />
      );
    case "form": {
      const wanted = Array.isArray(block.options?.fields) ? (block.options.fields as string[]) : undefined;
      return (
        <BlockFrame title={title}>
          <FormBlock
            fields={data.fields}
            choices={data.choices}
            narrow={data.narrow}
            action={env.formAction(data.table.id, wanted)}
            submitLabel={typeof block.options?.submitLabel === "string" ? block.options.submitLabel : "Save"}
          />
        </BlockFrame>
      );
    }
    case "details":
      return <DetailsBlock table={displayTable(blueprint, data.table)} record={data.record} labels={data.labels} ctx={ctx} blueprint={blueprint} basePath={env.sandbox?.basePath} options={block.options} />;
    case "records": {
      const props = { block, table: displayTable(blueprint, data.table), records: data.records, total: data.total, labels: data.labels, ctx };
      // Adding from a list on a record page links the new record to it (a line to its job).
      const defaults = recordDefaults(block.source?.filters, env.recordId);
      return (
        <BlockFrame title={title} action={<span className="flex items-center gap-2 text-xs text-muted">{data.total}<AddRecordButton table={data.table.id} label={data.table.label.toLowerCase()} defaults={defaults} /></span>}>
          {searchable && asked && (block.type === "table" || data.total > 6 || asked.q || Object.keys(asked.active).length > 0) && (
            <BlockSearch blockId={block.id} q={asked.q} active={asked.active} fields={await filterOptions(blueprint, store, searchable, block, now)} />
          )}
          {block.type === "table" && <TableBlock {...props} />}
          {block.type === "list" && <ListBlock {...props} />}
          {block.type === "gallery" && <GalleryBlock {...props} />}
          {block.type === "board" && <BoardBlock {...props} groups={data.groups} />}
          {block.type === "calendar" && <CalendarBlock {...props} groups={data.groups} now={now} />}
        </BlockFrame>
      );
    }
  }
}
