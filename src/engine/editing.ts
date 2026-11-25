import { GRID_COLUMNS, type Block, type BlockType, type Blueprint, type Field, type Page, type Table } from "@/schema/blueprint";
import type { LayoutKey } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";

/** Pure helpers behind Edit mode. They only produce change-set operations. */

// ---------- ids ----------

/** Every id in use (tables, pages, blocks, automations, connections, and fields of `tableId`). */
export function takenIds(bp: Blueprint, tableId?: string): Set<string> {
  const ids = new Set<string>();
  bp.tables.forEach((t) => ids.add(t.id));
  bp.pages.forEach((p) => {
    ids.add(p.id);
    p.layout.blocks.forEach((b) => ids.add(b.id));
    Object.values(p.layoutOverrides ?? {}).forEach((o) => o?.blocks.forEach((b) => ids.add(b.id)));
  });
  bp.automations.forEach((a) => ids.add(a.id));
  bp.connections.forEach((c) => ids.add(c.id));
  if (tableId) bp.tables.find((t) => t.id === tableId)?.fields.forEach((f) => ids.add(f.id));
  return ids;
}

/** A stable id from a label: `fld_favourite_tech`, `fld_favourite_tech_2`, … */
export function newId(prefix: string, label: string, taken: Set<string>): string {
  const slug =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "item";
  let id = `${prefix}_${slug}`;
  for (let n = 2; taken.has(id); n++) id = `${prefix}_${slug}_${n}`;
  taken.add(id);
  return id;
}

// ---------- grid ----------

const overlaps = (a: Block, b: Block) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const clampMove = (b: Block, x: number, y: number) => ({
  x: Math.max(0, Math.min(GRID_COLUMNS - b.w, Math.round(x))),
  y: Math.max(0, Math.round(y)),
});

export const clampSize = (b: Block, w: number, h: number) => ({
  w: Math.max(1, Math.min(GRID_COLUMNS - b.x, Math.round(w))),
  h: Math.max(1, Math.min(50, Math.round(h))),
});

/**
 * After `movedId` changed, push any blocks it now overlaps downward (repeatedly), like a
 * gravity-free stacking layout. Returns new positions for blocks that moved.
 */
export function pushDown(blocks: Block[], movedId: string): Block[] {
  const out = blocks.map((b) => ({ ...b }));
  const queue = [movedId];
  let guard = 0;
  while (queue.length && guard++ < 500) {
    const moverId = queue.shift();
    const mover = out.find((b) => b.id === moverId)!;
    for (const other of out) {
      if (other.id === mover.id || !overlaps(mover, other)) continue;
      other.y = mover.y + mover.h;
      queue.push(other.id);
    }
  }
  return out;
}

/** Ops for moving/resizing one block, including blocks pushed out of the way. */
export function layoutOps(
  pageId: string,
  blocks: Block[],
  blockId: string,
  change: { x?: number; y?: number; w?: number; h?: number },
  layout?: LayoutKey,
): Operation[] {
  const target = blocks.find((b) => b.id === blockId);
  if (!target) return [];
  const moved = { ...target };
  if (change.w !== undefined || change.h !== undefined) Object.assign(moved, clampSize(moved, change.w ?? moved.w, change.h ?? moved.h));
  if (change.x !== undefined || change.y !== undefined) Object.assign(moved, clampMove(moved, change.x ?? moved.x, change.y ?? moved.y));
  const next = pushDown(blocks.map((b) => (b.id === blockId ? moved : b)), blockId);

  const ops: Operation[] = [];
  for (const b of next) {
    const before = blocks.find((x) => x.id === b.id)!;
    if (b.w !== before.w || b.h !== before.h) ops.push({ op: "resizeBlock", pageId, blockId: b.id, w: b.w, h: b.h, layout });
    if (b.x !== before.x || b.y !== before.y) ops.push({ op: "moveBlock", pageId, blockId: b.id, x: b.x, y: b.y, layout });
  }
  return ops;
}

// ---------- compacting a pending change set ----------

const targetKey = (op: Operation): string | null => {
  switch (op.op) {
    case "moveBlock":
    case "resizeBlock":
      return `${op.op}:${op.pageId}:${op.layout ?? ""}:${op.blockId}`;
    case "rename":
      return `rename:${JSON.stringify(op.target)}`;
    case "setPageHidden":
      return `hidden:${op.pageId}`;
    case "reorderPages":
      return "reorder";
    default:
      return null;
  }
};

/** Keeps only the last of repeated same-target ops (e.g. many drags of one block). */
export function compactOps(ops: Operation[]): Operation[] {
  const lastIndex = new Map<string, number>();
  ops.forEach((op, i) => {
    const k = targetKey(op);
    if (k) lastIndex.set(k, i);
  });
  return ops.filter((op, i) => {
    const k = targetKey(op);
    return !k || lastIndex.get(k) === i;
  });
}

// ---------- menu ----------

/** All pages (hidden too) in menu order. */
export function menuOrder(bp: Blueprint): Page[] {
  return bp.pages
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.menuOrder - b.p.menuOrder || a.i - b.i)
    .map(({ p }) => p);
}

export function movePageOp(bp: Blueprint, pageId: string, delta: -1 | 1): Operation | null {
  const ids = menuOrder(bp).map((p) => p.id);
  const i = ids.indexOf(pageId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { op: "reorderPages", pageIds: ids };
}

// ---------- new pages, blocks and fields ----------

export type PageTemplate = "blank" | "table" | "board" | "calendar" | "dashboard";

export const PAGE_TEMPLATES: { id: PageTemplate; label: string; needsTable: boolean }[] = [
  { id: "blank", label: "Blank page", needsTable: false },
  { id: "table", label: "Table", needsTable: true },
  { id: "board", label: "Board by status", needsTable: true },
  { id: "calendar", label: "Calendar", needsTable: true },
  { id: "dashboard", label: "Numbers + list", needsTable: true },
];

/** Builds an addPage op. Returns an error message if the template doesn't fit the table. */
export function newPageOp(bp: Blueprint, label: string, template: PageTemplate, tableId?: string): Operation | string {
  const taken = takenIds(bp);
  const id = newId("pg", label, taken);
  const table = bp.tables.find((t) => t.id === tableId);
  if (template !== "blank" && !table) return "Pick a table for this layout.";
  const blk = (type: BlockType, x: number, y: number, w: number, h: number, extra: Partial<Block> = {}): Block => ({
    id: newId("blk", `${label}_${type}`, taken),
    type,
    source: table ? { table: table.id } : undefined,
    x,
    y,
    w,
    h,
    ...extra,
  });

  let blocks: Block[] = [];
  switch (template) {
    case "table":
      blocks = [blk("table", 0, 0, 12, 7)];
      break;
    case "board": {
      const status = table!.fields.find((f) => f.type === "status" || (f.type === "choice" && !f.multiple));
      if (!status) return `${table!.label} has no status or choice field to make a board from.`;
      blocks = [blk("board", 0, 0, 12, 7, { source: { table: table!.id, groupBy: status.id } })];
      break;
    }
    case "calendar": {
      const date = table!.fields.find((f) => f.type === "datetime" || f.type === "date");
      if (!date) return `${table!.label} has no date field to put on a calendar.`;
      blocks = [blk("calendar", 0, 0, 12, 8, { source: { table: table!.id, field: date.id }, options: { view: "week" } })];
      break;
    }
    case "dashboard":
      blocks = [blk("number", 0, 0, 4, 1, { options: { title: `All ${table!.label.toLowerCase()}` } }), blk("list", 0, 1, 12, 6)];
      break;
  }

  const maxOrder = bp.pages.reduce((m, p) => Math.max(m, p.menuOrder), -1);
  return {
    op: "addPage",
    page: { id, label, icon: "box", menuOrder: maxOrder + 1, hidden: false, layout: { columns: GRID_COLUMNS, blocks } },
  };
}

export const ADDABLE_BLOCKS: { type: BlockType; label: string; needsTable: boolean }[] = [
  { type: "table", label: "Table", needsTable: true },
  { type: "list", label: "List", needsTable: true },
  { type: "board", label: "Board", needsTable: true },
  { type: "calendar", label: "Calendar", needsTable: true },
  { type: "number", label: "Number", needsTable: true },
  { type: "form", label: "Form", needsTable: true },
  { type: "notes", label: "Note", needsTable: false },
];

const DEFAULT_SIZE: Partial<Record<BlockType, [number, number]>> = {
  number: [4, 1],
  form: [4, 5],
  notes: [4, 3],
  calendar: [12, 7],
  board: [12, 6],
  list: [4, 5],
  table: [12, 6],
};

/** Adds a block under everything else on the layout. */
export function newBlockOp(
  bp: Blueprint,
  page: Page,
  blocks: Block[],
  type: BlockType,
  tableId: string | undefined,
  layout?: LayoutKey,
): Operation | string {
  const table = bp.tables.find((t) => t.id === tableId);
  if (ADDABLE_BLOCKS.find((b) => b.type === type)?.needsTable && !table) return "Pick a table for this block.";
  if (type === "board" && table && !table.fields.some((f) => f.type === "status" || (f.type === "choice" && !f.multiple))) {
    return `${table.label} has no status or choice field to group by.`;
  }
  if (type === "calendar" && table && !table.fields.some((f) => f.type === "datetime" || f.type === "date")) {
    return `${table.label} has no date field.`;
  }
  const [w, h] = DEFAULT_SIZE[type] ?? [6, 4];
  const y = blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  const block: Block = {
    id: newId("blk", `${page.label}_${type}`, takenIds(bp)),
    type,
    source: table ? { table: table.id } : undefined,
    x: 0,
    y,
    w,
    h,
    options: type === "notes" ? { title: "Note", text: "" } : undefined,
  };
  if (!block.options) delete block.options;
  if (!block.source) delete block.source;
  return { op: "addBlock", pageId: page.id, block, layout };
}

export const ADDABLE_FIELD_TYPES: { type: Field["type"]; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "long_text", label: "Long text" },
  { type: "number", label: "Number" },
  { type: "money", label: "Money" },
  { type: "date", label: "Date" },
  { type: "datetime", label: "Date & time" },
  { type: "checkbox", label: "Checkbox" },
  { type: "status", label: "Status" },
  { type: "choice", label: "Choice" },
  { type: "phone", label: "Phone" },
  { type: "email", label: "Email" },
  { type: "link", label: "Link to another table" },
];

/** Builds an addField op from Edit mode input. `options` are labels for status/choice. */
export function newFieldOp(
  bp: Blueprint,
  table: Table,
  input: { label: string; type: Field["type"]; options?: string[]; linkTo?: string },
): Operation | string {
  const label = input.label.trim();
  if (!label) return "Give the field a name.";
  const id = newId("fld", label, takenIds(bp, table.id));
  let field: Field;
  switch (input.type) {
    case "status":
    case "choice": {
      const labels = [...new Set((input.options ?? []).map((o) => o.trim()).filter(Boolean))];
      if (!labels.length) return "Add at least one option.";
      const taken = new Set<string>();
      field = { id, label, type: input.type, options: labels.map((l) => ({ id: newId("opt", l, taken), label: l })) };
      break;
    }
    case "link":
      if (!bp.tables.some((t) => t.id === input.linkTo)) return "Pick the table to link to.";
      field = { id, label, type: "link", to: input.linkTo! };
      break;
    case "formula":
    case "rollup":
      return "That field type can't be added here yet.";
    default:
      field = { id, label, type: input.type } as Field;
  }
  return { op: "addField", tableId: table.id, field };
}

/** Descriptions of the risky ops in a preview (for the confirmation dialog). */
export function riskyOps(preview: { ops: { risk: string; description: string }[] }): string[] {
  return preview.ops.filter((o) => o.risk === "risky").map((o) => o.description);
}

// ---------- keeping layouts tidy ----------

/**
 * Extra moveBlock ops so blocks that `ops` added, moved or resized don't cover other blocks: those
 * get pushed down (the AI path; drag-and-drop already uses layoutOps). Default layouts only.
 */
export function overlapFixOps(after: Blueprint, ops: Operation[]): Operation[] {
  const touched = new Map<string, Set<string>>();
  for (const op of ops) {
    const add = (pageId: string, blockId: string) => {
      if ("layout" in op && op.layout) return;
      (touched.get(pageId) ?? touched.set(pageId, new Set()).get(pageId)!).add(blockId);
    };
    if (op.op === "addBlock" || op.op === "updateBlock") add(op.pageId, op.block.id);
    if (op.op === "moveBlock" || op.op === "resizeBlock") add(op.pageId, op.blockId);
  }
  const fixes: Operation[] = [];
  for (const [pageId, ids] of touched) {
    const page = after.pages.find((p) => p.id === pageId);
    if (!page) continue;
    let blocks = page.layout.blocks;
    for (const id of ids) if (blocks.some((b) => b.id === id)) blocks = pushDown(blocks, id);
    for (const b of blocks) {
      const before = page.layout.blocks.find((x) => x.id === b.id)!;
      if (b.y !== before.y) fixes.push({ op: "moveBlock", pageId, blockId: b.id, x: b.x, y: b.y });
    }
  }
  return fixes;
}
