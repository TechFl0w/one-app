import type { Block } from "@/schema/blueprint";
import { GRID_COLUMNS } from "@/schema/blueprint";
import { gridRows, readingOrder, type ResolvedLayout } from "@/engine/layout";

/** Height of one grid row in px. Blocks span `h` rows. */
export const ROW_HEIGHT = 92;

/**
 * Renders blocks on the 12-column grid. Blocks are emitted in reading order, so on narrow screens
 * (or `stack`) they fall into one column; from `md` up they are placed by x/y/w/h.
 * A device-specific layout (e.g. device:phone) is always shown as a grid.
 */
export function PageGrid({
  layout,
  renderBlock,
}: {
  layout: ResolvedLayout;
  renderBlock: (block: Block) => React.ReactNode;
}) {
  const blocks = readingOrder(layout.blocks);
  const alwaysGrid = layout.source.startsWith("device:");

  if (blocks.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-1 p-12 text-center">
        <p className="font-semibold">This page is empty</p>
        <p className="text-sm text-muted">Add blocks in Edit mode, or ask the assistant to build it.</p>
      </div>
    );
  }

  return (
    <div
      className={`gap-4 ${alwaysGrid ? "grid" : "flex flex-col md:grid"}`}
      style={{
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${gridRows(blocks)}, ${ROW_HEIGHT}px)`,
      }}
      data-layout={layout.source}
    >
      {blocks.map((b) => (
        <div
          key={b.id}
          className="min-h-0 min-w-0 [--stack-min:calc(var(--h)*60px)] max-md:min-h-[var(--stack-min)]"
          style={
            {
              gridColumn: `${b.x + 1} / span ${b.w}`,
              gridRow: `${b.y + 1} / span ${b.h}`,
              "--h": b.h,
            } as React.CSSProperties
          }
          data-block={b.id}
        >
          {renderBlock(b)}
        </div>
      ))}
    </div>
  );
}
