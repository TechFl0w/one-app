import type { Block, Blueprint } from "@/schema/blueprint";
import type { RecordStore } from "@/engine/store";
import { loadBlockData } from "@/engine/blockData";
import { BlockFrame } from "./BlockFrame";
import { BoardBlock, DetailsBlock, Empty, GalleryBlock, ListBlock, NotesBlock, NumberBlock, TableBlock } from "./RecordBlocks";
import { displayTable } from "@/engine/blockData";
import { recordDefaults } from "@/engine/recordPage";
import { AddRecordButton } from "./RecordOpener";
import { CalendarBlock } from "./CalendarBlock";
import { HeaderBlock } from "./HeaderBlock";
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
  const data = await loadBlockData(block, blueprint, store, { now, recordId: env.recordId });

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
    case "header":
      return <HeaderBlock block={block} blueprint={blueprint} stats={data.stats} ctx={ctx} now={now} />;
    case "form": {
      const wanted = Array.isArray(block.options?.fields) ? (block.options.fields as string[]) : undefined;
      return (
        <BlockFrame title={title}>
          <FormBlock
            fields={data.fields}
            choices={data.choices}
            action={env.formAction(data.table.id, wanted)}
            submitLabel={typeof block.options?.submitLabel === "string" ? block.options.submitLabel : "Save"}
          />
        </BlockFrame>
      );
    }
    case "details":
      return <DetailsBlock table={displayTable(blueprint, data.table)} record={data.record} labels={data.labels} ctx={ctx} blueprint={blueprint} basePath={env.sandbox?.basePath} />;
    case "records": {
      const props = { block, table: displayTable(blueprint, data.table), records: data.records, total: data.total, labels: data.labels, ctx };
      // Adding from a list on a record page links the new record to it (a line to its job).
      const defaults = recordDefaults(block.source?.filters, env.recordId);
      return (
        <BlockFrame title={title} action={<span className="flex items-center gap-2 text-xs text-muted">{data.total}<AddRecordButton table={data.table.id} label={data.table.label.toLowerCase()} defaults={defaults} /></span>}>
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
