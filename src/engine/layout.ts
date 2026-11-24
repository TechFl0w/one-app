import type { Block, Blueprint, LayoutKey, Page } from "@/schema/blueprint";

/** Pure helpers for turning a blueprint into what the shell renders. */

export type Device = "phone" | "tablet" | "desktop";

/** Visible pages in menu order. */
export function menuPages(blueprint: Blueprint): Page[] {
  return blueprint.pages
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.hidden)
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
