"use client";

import { isFullPageComponent, sandboxSchema } from "@/sandbox/schema";
import { SandboxFrame } from "@/components/sandbox/SandboxFrame";
import { useSandbox } from "@/components/sandbox/SandboxProvider";
import { useRef, useState } from "react";
import { GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { GRID_COLUMNS, type Block, type LayoutKey } from "@/schema/blueprint";
import { gridRows, layoutBlocks, layoutTargets, readingOrder, resolveLayout, stackForPhone, type Device, type LayoutTarget } from "@/engine/layout";
import { clampMove, clampSize, layoutOps } from "@/engine/editing";
import { PageIcon } from "@/components/shell/Icon";
import { useEdit } from "@/components/edit/EditProvider";
import { EditButton, EditChrome } from "@/components/edit/EditChrome";
import { AddBlockDialog } from "@/components/edit/AddDialogs";
import { BlockSettings } from "@/components/edit/BlockSettings";

/** Height of one grid row in px; must match the gap below for drag math. */
export const ROW_HEIGHT = 92;
const GAP = 16;

type Drag = { id: string; mode: "move" | "resize"; startX: number; startY: number; block: Block; preview: Block };

/**
 * A page: title + 12-column block grid. Block contents are rendered on the server and passed in
 * by id; this component positions them from the (draft) blueprint, so Edit mode can move,
 * resize, add and remove blocks with a live preview.
 */
export function EditablePage({
  pageId,
  device,
  userId,
  rendered,
}: {
  pageId: string;
  device: Device;
  userId?: string;
  rendered: Record<string, React.ReactNode>;
}) {
  const { blueprint, editing, push } = useEdit();
  const sandbox = useSandbox();
  // Custom blocks the server hasn't rendered (a draft, or the demo's local changes) render here.
  const view = (b: Block, fullPage = false) => {
    if (rendered[b.id]) return rendered[b.id];
    const c = b.type === "custom" ? blueprint.components?.find((x) => x.id === b.options?.component) : undefined;
    if (!c || !sandbox) return null;
    const props = b.options?.props && typeof b.options.props === "object" ? (b.options.props as Record<string, unknown>) : {};
    const frame = <SandboxFrame title={c.label} componentId={c.id} theme={blueprint.theme} compiled={c.compiled} props={props} schema={sandboxSchema(blueprint)} bridge={sandbox.bridge} basePath={sandbox.basePath} autoHeight />;
    return fullPage ? frame : <div className="h-full overflow-hidden rounded-card">{frame}</div>;
  };
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // Which layout Edit mode works on; null = the one this viewer currently sees.
  const [target, setTarget] = useState<LayoutTarget | null>(null);
  if (!editing && target !== null) setTarget(null);

  const page = blueprint.pages.find((p) => p.id === pageId);
  if (!page) {
    return (
      <>
        <EditChrome />
        <div className="card p-12 text-center text-muted">This page doesn’t exist (anymore).</div>
      </>
    );
  }

  const resolved = resolveLayout(page, { device, userId });
  const active: LayoutTarget = editing ? (target ?? resolved.source) : resolved.source;
  const activeBlocks = editing ? layoutBlocks(page, active) : resolved.blocks;
  const sourceBlocks = activeBlocks ?? [];
  const layoutKey: LayoutKey | undefined = active === "default" ? undefined : active;
  const alwaysGrid = active.startsWith("device:");
  const canvas = editing && active === "device:phone" ? "max-w-[420px]" : editing && active === "device:tablet" ? "max-w-[820px]" : "";
  const blocks = readingOrder(sourceBlocks).map((b) => (drag?.id === b.id ? drag.preview : b));
  const settingsBlock = sourceBlocks.find((b) => b.id === settingsFor);
  const targets = layoutTargets(page, userId);
  const activeLabel = targets.find((t) => t.key === active)?.label ?? "This";

  const step = () => {
    const width = gridRef.current?.clientWidth ?? 1200;
    return { col: (width - GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS + GAP, row: ROW_HEIGHT + GAP };
  };

  const begin = (e: React.PointerEvent, block: Block, mode: Drag["mode"]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: block.id, mode, startX: e.clientX, startY: e.clientY, block, preview: block });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const s = step();
    const dc = Math.round((e.clientX - drag.startX) / s.col);
    const dr = Math.round((e.clientY - drag.startY) / s.row);
    const b = drag.block;
    const preview =
      drag.mode === "move" ? { ...b, ...clampMove(b, b.x + dc, b.y + dr) } : { ...b, ...clampSize(b, b.w + dc, b.h + dr) };
    if (preview.x !== drag.preview.x || preview.y !== drag.preview.y || preview.w !== drag.preview.w || preview.h !== drag.preview.h) {
      setDrag({ ...drag, preview });
    }
  };
  const end = () => {
    if (!drag) return;
    const { block: b, preview: p } = drag;
    setDrag(null);
    if (p.x === b.x && p.y === b.y && p.w === b.w && p.h === b.h) return;
    const change = drag.mode === "move" ? { x: p.x, y: p.y } : { w: p.w, h: p.h };
    push(layoutOps(page.id, sourceBlocks, b.id, change, layoutKey));
  };
  const nudge = (e: React.KeyboardEvent, b: Block) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const change = e.shiftKey ? { w: b.w + d[0], h: b.h + d[1] } : { x: b.x + d[0], y: b.y + d[1] };
    push(layoutOps(page.id, sourceBlocks, b.id, change, layoutKey));
  };

  const rows = Math.max(gridRows(blocks), editing ? gridRows(blocks) + 2 : 0);
  // With generated components on the page (and not editing), rows fit their content: a custom
  // block is as tall as it renders (e.g. a collapsed section), standard blocks keep their size.
  const flow = !editing && blocks.some((b) => b.type === "custom");
  const fixedHeight = (h: number) => h * ROW_HEIGHT + (h - 1) * GAP;

  return (
    <div className="mx-auto max-w-[1400px]">
      <EditChrome
        extra={
          <button type="button" className="btn-ghost px-4 py-2" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Block
          </button>
        }
      />
      <div className="mb-6 flex items-center gap-3">
        <PageIcon name={page.icon} className="h-6 w-6 shrink-0 text-accent" />
        {editing ? (
          <input
            key={`${page.id}:${page.label}`}
            aria-label="Page name"
            className="min-w-0 flex-1 rounded-xl border border-dashed border-line bg-transparent px-2 py-0.5 text-2xl font-bold tracking-tight outline-none focus:border-accent"
            defaultValue={page.label}
            maxLength={80}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== page.label) push({ op: "rename", target: { kind: "page", pageId: page.id }, label: v });
              else e.target.value = page.label;
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">{page.label}</h1>
        )}
        <EditButton />
      </div>
      {editing && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Layout for</span>
          <div role="radiogroup" aria-label="Layout to edit" className="flex flex-wrap gap-1 rounded-full bg-card p-1 shadow-soft">
            {targets.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={t.key === active}
                onClick={() => setTarget(t.key)}
                className={`rounded-full px-3 py-1 text-sm ${t.key === active ? "bg-accent text-white" : "text-muted hover:bg-ground"} ${!t.exists && t.key !== active ? "italic" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {activeBlocks && active !== "default" && (
            <button type="button" className="text-sm text-muted underline hover:text-ink" onClick={() => push({ op: "removeLayoutOverride", pageId: page.id, layout: active })}>
              Use the Everyone layout instead
            </button>
          )}
        </div>
      )}
      {editing && !activeBlocks && active !== "default" && (
        <div className="card mb-6 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            <strong>{activeLabel}</strong> {active.startsWith("user:") ? "uses" : "use"} the Everyone layout. Give {active.startsWith("user:") ? "yourself" : "them"} a separate one to arrange blocks differently.
          </p>
          <button type="button" className="btn-primary" onClick={() =>
              push(
                active === "device:phone"
                  ? { op: "setLayoutOverride", pageId: page.id, layout: active, blocks: stackForPhone(page.layout.blocks) }
                  : { op: "createLayoutOverride", pageId: page.id, layout: active },
              )
            }>
            Create {activeLabel.toLowerCase()} layout
          </button>
        </div>
      )}

      {!editing && isFullPageComponent(blocks) ? (
        <div data-block={blocks[0].id}>{view(blocks[0], true)}</div>
      ) : editing && !activeBlocks ? null : blocks.length === 0 && !editing ? (
        <div className="card flex flex-col items-center justify-center gap-1 p-12 text-center">
          <p className="font-semibold">This page is empty</p>
          <p className="text-sm text-muted">Click Edit to add blocks, or ask the assistant to build it.</p>
        </div>
      ) : (
        <div
          ref={gridRef}
          className={`relative mx-auto gap-4 ${canvas} ${alwaysGrid ? "grid" : "flex flex-col md:grid"} ${editing ? "rounded-card md:bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px)] md:[background-size:calc((100%+16px)/12)_100%]" : ""}`}
          style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: flow ? `repeat(${rows}, auto)` : `repeat(${rows}, ${ROW_HEIGHT}px)` }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={() => setDrag(null)}
          data-layout={active}
        >
          {blocks.map((b) => (
            <div
              key={b.id}
              className={`relative min-h-0 min-w-0 ${flow && b.type === "custom" ? "self-start" : "max-md:min-h-[calc(var(--h)*60px)]"} ${flow && b.type !== "custom" ? "md:h-[var(--fixed)]" : ""} ${drag?.id === b.id ? "z-10 opacity-90" : ""}`}
              style={{ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}`, "--h": b.h, "--fixed": `${fixedHeight(b.h)}px` } as React.CSSProperties}
              data-block={b.id}
            >
              <div className={`h-full ${editing ? "pointer-events-none select-none" : ""}`} aria-hidden={editing || undefined}>
                {view(b) ?? (
                  <div className="card flex h-full items-center justify-center p-4 text-center text-sm text-muted">
                    New {b.type} block — save to load its data
                  </div>
                )}
              </div>
              {editing && (
                <div className={`absolute inset-0 rounded-card ring-2 ${drag?.id === b.id ? "ring-accent" : "ring-accent/30 hover:ring-accent/70"}`}>
                  <div className="absolute inset-x-0 top-0 flex items-center gap-1 rounded-t-card bg-card px-3 pb-2 pt-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1 rounded-full bg-ground px-2 py-1 text-xs font-semibold active:cursor-grabbing max-md:pointer-events-none"
                      onPointerDown={(e) => begin(e, b, "move")}
                      onKeyDown={(e) => nudge(e, b)}
                      aria-label={`Move ${b.type} block (arrow keys; shift+arrows to resize)`}
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted" />
                      <span className="truncate">{typeof b.options?.title === "string" ? b.options.title : b.type}</span>
                    </button>
                    <button type="button" className="rounded-full p-1.5 hover:bg-ground hover:text-accent" onClick={() => setSettingsFor(b.id)} aria-label="Block settings">
                      <Settings2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded-full p-1.5 hover:bg-red-50 hover:text-red-700"
                      onClick={() => push({ op: "removeBlock", pageId: page.id, blockId: b.id, layout: layoutKey })}
                      aria-label="Remove block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div
                    className="absolute bottom-1 right-1 h-5 w-5 cursor-se-resize touch-none rounded-br-[18px] border-b-[3px] border-r-[3px] border-accent/60 max-md:hidden"
                    onPointerDown={(e) => begin(e, b, "resize")}
                    role="presentation"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {editing && <p className="mt-3 text-xs text-muted md:hidden">Moving and resizing blocks works on a larger screen.</p>}

      {settingsBlock && (
        <BlockSettings open onClose={() => setSettingsFor(null)} pageId={page.id} block={settingsBlock} layout={layoutKey} />
      )}
      <AddBlockDialog open={adding} onClose={() => setAdding(false)} page={page} layout={layoutKey} blocks={sourceBlocks} />
    </div>
  );
}
