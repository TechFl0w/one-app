import { GRID_COLUMNS, type Block, type Blueprint } from "@/schema/blueprint";

const TINT: Record<string, string> = {
  header: "#E3F1EB", number: "#EAF1FA", board: "#FCEFE6", table: "#F2EEE6", list: "#F2EEE6", gallery: "#FBF3E4",
  calendar: "#EDF3FA", custom: "#F2EDFA", form: "#EFEBE3", notes: "#EFEBE3", details: "#E3F1EB", document: "#FAF8F4", activity: "#EFEBE3",
};

/** A page's layout in miniature: each block where it sits, what it is and what it shows. */
export function LayoutSketch({ blueprint, blocks }: { blueprint: Blueprint; blocks: Block[] }) {
  const rows = blocks.reduce((m, b) => Math.max(m, b.y + b.h), 1);
  const label = (b: Block) => {
    if (typeof b.options?.title === "string") return b.options.title;
    if (b.type === "custom") return blueprint.components?.find((c) => c.id === b.options?.component)?.label ?? "Custom screen";
    return blueprint.tables.find((t) => t.id === b.source?.table)?.label ?? "";
  };
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, 22px)` }}>
      {blocks.map((b) => (
        <div key={b.id} className="overflow-hidden rounded-md border border-line/70 px-1.5 py-0.5 text-[10px] leading-tight" style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}`, background: TINT[b.type] ?? "#F7F5F0" }}>
          <b className="uppercase tracking-wide text-muted">{b.type}</b> <span className="text-ink/80">{label(b)}</span>
        </div>
      ))}
    </div>
  );
}
