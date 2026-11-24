import type { Block, Blueprint } from "@/schema/blueprint";
import { BlockFrame } from "./BlockFrame";

/** Title shown on a block: options.title, else the source table's label, else the block type. */
export function blockTitle(block: Block, blueprint: Blueprint): string {
  const t = block.options?.title;
  if (typeof t === "string" && t.trim()) return t;
  const table = block.source && blueprint.tables.find((x) => x.id === block.source!.table);
  return table?.label ?? block.type[0].toUpperCase() + block.type.slice(1);
}

/** Placeholder renderer; real block types arrive with roadmap task 6. */
export function BlockView({ block, blueprint }: { block: Block; blueprint: Blueprint }) {
  return (
    <BlockFrame title={blockTitle(block, blueprint)} bodyClassName="flex items-center justify-center px-5 pb-5">
      <span className="rounded-full bg-accent-tint px-3 py-1 text-xs font-medium text-accent">{block.type} block</span>
    </BlockFrame>
  );
}
