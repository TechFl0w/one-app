"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSandbox } from "@/components/sandbox/SandboxProvider";

export interface BoardColumn {
  id: string | null;
  label: string;
  color?: string;
}

/**
 * A board whose cards can be dragged between columns (mouse, touch and pen). Dropping saves the
 * card's group field; the card moves right away and moves back if saving fails. Cards still open
 * their record on a plain click. `locked` (a column field that follows dates) disables moving.
 */
export function DragBoard({
  table,
  field,
  columns,
  cards,
  locked,
}: {
  table: string;
  field: string;
  columns: BoardColumn[];
  cards: { id: string; group: string | null; node: React.ReactNode }[];
  locked?: string;
}) {
  const sandbox = useSandbox();
  const router = useRouter();
  const key = cards.map((c) => `${c.id}:${c.group}`).join("|");
  const [placed, setPlaced] = useState(() => ({ key, map: new Map(cards.map((c) => [c.id, c.group])) }));
  // New data from the server (after a refresh) wins over local moves.
  if (placed.key !== key) setPlaced({ key, map: new Map(cards.map((c) => [c.id, c.group])) });
  const where = placed.map;
  const place = (id: string, g: string | null) => setPlaced((p) => ({ key: p.key, map: new Map(p.map).set(id, g) }));
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; w: number; over: string | null | undefined; moved: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const canMove = !!sandbox && !locked;
  const columnAt = (x: number, y: number): string | null | undefined => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-board-column]");
    if (!el) return undefined;
    const v = el.dataset.boardColumn!;
    return v === "_none" ? null : v;
  };

  const move = async (id: string, to: string | null) => {
    const from = where.get(id) ?? null;
    if (from === to || !sandbox) return;
    place(id, to);
    const r = await sandbox.bridge.update(table, id, { [field]: to });
    if (!r.ok) {
      place(id, from);
      setError(r.code === "needs_confirmation" ? "Open the card to change that." : `Couldn’t move it: ${r.error}`);
      return;
    }
    router.refresh();
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (!canMove || e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    start.current = { x: e.clientX, y: e.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrag({ id, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, over: undefined, moved: false });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || !start.current) return;
    const far = Math.abs(e.clientX - start.current.x) + Math.abs(e.clientY - start.current.y) > 6;
    if (!drag.moved && !far) return;
    // Capture only once it's a real drag: a plain click must still reach the card (it opens it).
    if (!drag.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // Near the board's edge: scroll, so columns off-screen can be reached.
    const box = scroller.current?.getBoundingClientRect();
    if (box && scroller.current) {
      if (e.clientX > box.right - 60) scroller.current.scrollLeft += 24;
      else if (e.clientX < box.left + 60) scroller.current.scrollLeft -= 24;
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY, over: columnAt(e.clientX, e.clientY), moved: true });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    start.current = null;
    if (!d.moved) return; // a plain click: the card opens its record
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const to = columnAt(e.clientX, e.clientY);
    if (to !== undefined) void move(d.id, to);
  };

  const byColumn = (g: string | null) => cards.filter((c) => (where.get(c.id) ?? null) === g);
  const dragged = drag?.moved ? cards.find((c) => c.id === drag.id) : undefined;

  return (
    <div className="relative flex h-full flex-col">
      {locked && <p className="px-5 pb-2 text-xs text-muted">{locked}</p>}
      <div ref={scroller} className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-5" onClickCapture={(e) => suppressClick.current && (e.stopPropagation(), e.preventDefault())}>
        {columns.map((g) => {
          const items = byColumn(g.id);
          const over = drag?.moved && drag.over === g.id;
          return (
            <div
              key={g.id ?? "_none"}
              data-board-column={g.id ?? "_none"}
              className={`flex w-64 shrink-0 flex-col rounded-2xl p-2 transition-colors ${over ? "bg-accent-tint ring-2 ring-accent/40" : "bg-ground"}`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: g.color ?? "var(--muted)" }} />
                <span className="truncate text-sm font-semibold">{g.label}</span>
                <span className="ml-auto text-xs text-muted">{items.length}</span>
              </div>
              <div className="min-h-12 flex-1 space-y-2 overflow-y-auto p-0.5">
                {items.map((c) => (
                  <div
                    key={c.id}
                    onPointerDown={(e) => onPointerDown(e, c.id)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setDrag(null)}
                    className={`${canMove ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""} ${drag?.moved && drag.id === c.id ? "opacity-30" : ""}`}
                  >
                    {c.node}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {dragged && drag && (
        <div className="pointer-events-none fixed z-[100] rotate-2 shadow-lg" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>
          {dragged.node}
        </div>
      )}
      {error && <p role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-soft">{error}</p>}
    </div>
  );
}
