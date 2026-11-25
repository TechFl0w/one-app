import type { Block, Blueprint } from "@/schema/blueprint";
import type { RecordStore } from "@/engine/store";
import { loadBlockData } from "@/engine/blockData";
import { BlockFrame } from "./BlockFrame";
import { BoardBlock, Empty, ListBlock, NotesBlock, NumberBlock, TableBlock } from "./RecordBlocks";
import { CalendarBlock } from "./CalendarBlock";
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
}

export async function BlockView({ block, env, fullPage = false }: { block: Block; env: BlockEnv; fullPage?: boolean }) {
  const { blueprint, store, now } = env;
  const ctx: FormatCtx = { timezone: blueprint.business.timezone };
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
    const props = block.options?.props && typeof block.options.props === "object" ? (block.options.props as Record<string, unknown>) : {};
    return (
      <div className={fullPage ? "" : "h-full overflow-hidden rounded-card"}>
        <SandboxFrame
          title={component.label}
          compiled={component.compiled}
          props={props}
          schema={sandboxSchema(blueprint)}
          bridge={env.sandbox.bridge}
          basePath={env.sandbox.basePath}
          autoHeight={fullPage}
        />
      </div>
    );
  }
  const data = await loadBlockData(block, blueprint, store, { now });

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
    case "number":
      return (
        <BlockFrame title={title}>
          <NumberBlock value={data.value} field={data.field} agg={block.source?.agg ?? "count"} ctx={ctx} />
        </BlockFrame>
      );
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
    case "records": {
      const props = { block, table: data.table, records: data.records, total: data.total, labels: data.labels, ctx };
      return (
        <BlockFrame title={title} action={<span className="text-xs text-muted">{data.total}</span>}>
          {block.type === "table" && <TableBlock {...props} />}
          {block.type === "list" && <ListBlock {...props} />}
          {block.type === "board" && <BoardBlock {...props} groups={data.groups} />}
          {block.type === "calendar" && <CalendarBlock {...props} groups={data.groups} now={now} />}
        </BlockFrame>
      );
    }
  }
}
