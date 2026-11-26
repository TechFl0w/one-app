import type { Blueprint, Page } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";
import type { LayoutKey } from "@/schema/blueprint";

/**
 * Version history for one page. Restoring an older version is a normal change set (so it shows in
 * Activity and can itself be undone): the page's name, icon, blocks, device layouts and the
 * screens (components) it shows are put back the way they were in that version.
 */

/** Does a change set touch this page (its layout, or a screen shown on it)? */
export function touchesPage(ops: unknown[], pageId: string, componentIds: Set<string>): boolean {
  return ops.some((raw) => {
    const op = raw as { op?: string; pageId?: string; target?: { pageId?: string }; page?: { id?: string }; component?: { id?: string }; componentId?: string };
    return op.pageId === pageId || op.target?.pageId === pageId || op.page?.id === pageId || (!!op.component?.id && componentIds.has(op.component.id)) || (!!op.componentId && componentIds.has(op.componentId));
  });
}

export const componentsOn = (page: Page | undefined) =>
  new Set(
    [page?.layout.blocks ?? [], ...Object.values(page?.layoutOverrides ?? {}).map((o) => o?.blocks ?? [])]
      .flat()
      .filter((b) => b.type === "custom")
      .map((b) => String(b.options?.component ?? "")),
  );

/** The operations that make `pageId` in `current` look like it did in `old`. */
export function restorePageOps(current: Blueprint, old: Blueprint, pageId: string): Operation[] {
  const was = old.pages.find((p) => p.id === pageId);
  if (!was) throw new Error("That page didn't exist in this version.");
  const now = current.pages.find((p) => p.id === pageId);
  const ops: Operation[] = [];

  // Screens first, so blocks that show them are valid.
  for (const id of componentsOn(was)) {
    const then = old.components?.find((c) => c.id === id);
    const cur = current.components?.find((c) => c.id === id);
    if (then && JSON.stringify(then) !== JSON.stringify(cur)) ops.push({ op: "putComponent", component: structuredClone(then) });
  }

  if (!now) {
    ops.push({ op: "addPage", page: structuredClone(was) });
    return ops;
  }
  if (now.label !== was.label) ops.push({ op: "rename", target: { kind: "page", pageId }, label: was.label });
  if ((now.icon ?? null) !== (was.icon ?? null)) ops.push({ op: "setPageIcon", pageId, icon: was.icon ?? null });
  if (JSON.stringify(now.badge ?? null) !== JSON.stringify(was.badge ?? null)) ops.push({ op: "setPageBadge", pageId, badge: was.badge ?? null });
  if (now.hidden !== was.hidden) ops.push({ op: "setPageHidden", pageId, hidden: was.hidden });

  // Default layout: drop blocks that weren't there, put back the rest exactly.
  const before = new Map(was.layout.blocks.map((b) => [b.id, b]));
  for (const b of now.layout.blocks) if (!before.has(b.id)) ops.push({ op: "removeBlock", pageId, blockId: b.id });
  const present = new Set(now.layout.blocks.map((b) => b.id));
  for (const b of was.layout.blocks) {
    const cur = now.layout.blocks.find((x) => x.id === b.id);
    if (!present.has(b.id)) ops.push({ op: "addBlock", pageId, block: structuredClone(b) });
    else if (JSON.stringify(cur) !== JSON.stringify(b)) ops.push({ op: "updateBlock", pageId, block: structuredClone(b) });
  }
  // Phone / tablet / per-user layouts come back as a whole.
  const keys = new Set([...Object.keys(was.layoutOverrides ?? {}), ...Object.keys(now.layoutOverrides ?? {})]) as Set<LayoutKey>;
  for (const key of keys) {
    const then = was.layoutOverrides?.[key]?.blocks ?? null;
    const cur = now.layoutOverrides?.[key]?.blocks ?? null;
    if (JSON.stringify(then) !== JSON.stringify(cur)) ops.push({ op: "setLayoutOverride", pageId, layout: key, blocks: then && structuredClone(then) });
  }
  return ops;
}
