import type { Block, Blueprint, LayoutKey, Page } from "@/schema/blueprint";

/** Pure helpers for turning a blueprint into what the shell renders. */

export type Device = "phone" | "tablet" | "desktop";

/** Visible pages in menu order. */
export function menuPages(blueprint: Blueprint): Page[] {
  return blueprint.pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.hidden && !p.recordOf)
    .sort((a, b) => a.p.menuOrder - b.p.menuOrder || a.i - b.i)
    .map(({ p }) => p);
}

export interface ResolvedLayout {
  blocks: Block[];
  /** Which layout was used: a user override, a device override, or the default. */
  source: LayoutKey | "default";
  /** True when no phone layout exists, so the default should be stacked into one column. */
  stack: boolean;
}

/** Picks the layout to show: user override > device override > default. */
export function resolveLayout(page: Page, ctx: { device: Device; userId?: string }): ResolvedLayout {
  const overrides = page.layoutOverrides ?? {};
  const userKey = ctx.userId ? (`user:${ctx.userId}` as LayoutKey) : undefined;
  const deviceKey = `device:${ctx.device}` as LayoutKey;
  if (userKey && overrides[userKey]) return { blocks: overrides[userKey]!.blocks, source: userKey, stack: ctx.device === "phone" };
  if (overrides[deviceKey]) return { blocks: overrides[deviceKey]!.blocks, source: deviceKey, stack: false };
  return { blocks: page.layout.blocks, source: "default", stack: ctx.device === "phone" };
}

/** Reading order for stacked (one-column) display: top to bottom, then left to right. */
export function readingOrder(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Number of grid rows the layout needs. */
export function gridRows(blocks: Block[]): number {
  return blocks.reduce((max, b) => Math.max(max, b.y + b.h), 0);
}

export function deviceFromUserAgent(ua: { device: { type?: string } }): Device {
  if (ua.device.type === "mobile") return "phone";
  if (ua.device.type === "tablet") return "tablet";
  return "desktop";
}

export type LayoutTarget = LayoutKey | "default";

/** Blocks of one specific layout, or null if that override doesn't exist. */
export function layoutBlocks(page: Page, target: LayoutTarget): Block[] | null {
  if (target === "default") return page.layout.blocks;
  return page.layoutOverrides?.[target]?.blocks ?? null;
}

/** Layouts an editor can pick between, and whether each exists yet. */
export function layoutTargets(page: Page, userId?: string): { key: LayoutTarget; label: string; exists: boolean }[] {
  const list: { key: LayoutTarget; label: string }[] = [
    { key: "default", label: "Everyone" },
    { key: "device:phone", label: "Phones" },
    { key: "device:tablet", label: "Tablets" },
  ];
  if (userId) list.push({ key: `user:${userId}` as LayoutKey, label: "Just me" });
  return list.map((t) => ({ ...t, exists: layoutBlocks(page, t.key) !== null }));
}

/** A sensible starting phone layout: every block full width, stacked in reading order. */
export function stackForPhone(blocks: Block[]): Block[] {
  let y = 0;
  return readingOrder(blocks).map((b) => {
    const out = { ...b, x: 0, w: 12, y };
    y += b.h;
    return out;
  });
}

/** "device:phone" → "phone", "user:…" → "personal". */
export function layoutName(key: string): string {
  return key.startsWith("user:") ? "personal" : key.replace(/^device:/, "");
}

/**
 * Pages add records with a "+ New …" button at the top right and a pop-up form, never with a
 * form sitting on the page. Older pages that still have an add form show without it: the block
 * beside it takes its space.
 */
export function withoutAddForms<T extends { id: string; type: string; x: number; y: number; w: number; h: number }>(blocks: T[]): T[] {
  const forms = blocks.filter((b) => b.type === "form");
  if (!forms.length) return blocks;
  const rows = (a: T, b: T) => a.y < b.y + b.h && b.y < a.y + a.h;
  return blocks
    .filter((b) => b.type !== "form")
    .map((b) => {
      let { x, w } = b;
      for (const f of forms) {
        if (!rows(b, f)) continue;
        if (f.x === x + w) w += f.w; // the form was on its right
        else if (f.x + f.w === x) { x = f.x; w += f.w; } // on its left
      }
      return x === b.x && w === b.w ? b : { ...b, x, w };
    });
}

/** The table a page adds to with its "+ New …" button: its add form's, else its main list's. */
export function pageAddTable(blocks: { type: string; source?: { table: string; filters?: { value?: unknown }[] } }[]): string | undefined {
  const form = blocks.find((b) => b.type === "form" && b.source);
  if (form) return form.source!.table;
  const list = blocks.find((b) => ["table", "list", "gallery", "board", "calendar"].includes(b.type) && b.source && !(b.source.filters ?? []).some((f) => f.value === "@record"));
  return list?.source?.table;
}
