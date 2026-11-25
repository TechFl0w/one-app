import type { z } from "zod";
import { Blueprint, type Block, type LayoutKey, type Page } from "@/schema/blueprint";
import { ChangeSet, OP_RISK, type Operation } from "@/schema/changeSet";
import { layoutName } from "./layout";

/**
 * The single entry point for changing a blueprint (CLAUDE.md: "Blueprint changes go through one
 * function"). Everything here is pure: blueprint in, blueprint out. Persistence lives in
 * `src/server/blueprints.ts`.
 */

export type ChangeSetErrorCode = "invalid" | "not_found" | "conflict" | "needs_confirmation";

export class ChangeSetError extends Error {
  constructor(
    public readonly code: ChangeSetErrorCode,
    message: string,
    public readonly opIndex?: number,
    public readonly issues?: z.core.$ZodIssue[],
  ) {
    super(message);
    this.name = "ChangeSetError";
  }
}

export interface OpPreview {
  op: Operation["op"];
  risk: "safe" | "risky";
  description: string;
}

export interface ChangeSetResult {
  /** The new blueprint, version bumped by one. */
  blueprint: Blueprint;
  /** Applying this to `blueprint` undoes the change. */
  inverse: ChangeSet;
  ops: OpPreview[];
  requiresConfirmation: boolean;
}

export type PreviewResult =
  | ({ ok: true } & ChangeSetResult)
  | { ok: false; error: ChangeSetError };

export interface ApplyOptions {
  /** The user explicitly confirmed risky operations. */
  confirmed?: boolean;
  /**
   * Allow a change set built against an older version (used by undo of an older change).
   * Ops are applied by id against the current blueprint; anything that no longer fits fails.
   */
  allowRebase?: boolean;
}

/** Dry-run: what would happen, without throwing. Use this to render the preview. */
export function previewChangeSet(blueprint: Blueprint, changeSet: unknown, opts: ApplyOptions = {}): PreviewResult {
  try {
    return { ok: true, ...run(blueprint, changeSet, opts) };
  } catch (e) {
    if (e instanceof ChangeSetError) return { ok: false, error: e };
    throw e;
  }
}

/** Apply a change set. Throws `ChangeSetError`; risky ops require `confirmed: true`. */
export function applyChangeSet(blueprint: Blueprint, changeSet: unknown, opts: ApplyOptions = {}): ChangeSetResult {
  const result = run(blueprint, changeSet, opts);
  if (result.requiresConfirmation && !opts.confirmed) {
    const risky = result.ops.filter((o) => o.risk === "risky").map((o) => o.description);
    throw new ChangeSetError("needs_confirmation", `Needs confirmation: ${risky.join("; ")}`);
  }
  return result;
}

/**
 * Undo a previously applied change by applying its stored inverse to the current blueprint.
 * Works for the latest change and, where nothing conflicts, for older ones.
 */
export function undoChangeSet(
  current: Blueprint,
  inverse: ChangeSet,
  opts: Pick<ApplyOptions, "confirmed"> = {},
): ChangeSetResult {
  return applyChangeSet(
    current,
    { ...inverse, baseVersion: current.version, source: "undo" },
    { ...opts, allowRebase: true },
  );
}

// ---------------------------------------------------------------------------

function run(blueprint: Blueprint, input: unknown, opts: ApplyOptions): ChangeSetResult {
  const parsed = ChangeSet.safeParse(input);
  if (!parsed.success) {
    throw new ChangeSetError("invalid", "Change set is not valid", undefined, parsed.error.issues);
  }
  const cs = parsed.data;
  if (cs.baseVersion !== blueprint.version && !opts.allowRebase) {
    throw new ChangeSetError(
      "conflict",
      `Change set was built for version ${cs.baseVersion} but the blueprint is at version ${blueprint.version}`,
    );
  }

  const draft: Blueprint = structuredClone(blueprint);
  const inverseOps: Operation[][] = [];
  const previews: OpPreview[] = [];

  cs.ops.forEach((op, i) => {
    try {
      previews.push({ op: op.op, risk: OP_RISK[op.op], description: describe(draft, op) });
      inverseOps.push(applyOp(draft, op));
    } catch (e) {
      if (e instanceof ChangeSetError) throw new ChangeSetError(e.code, `Step ${i + 1}: ${e.message}`, i);
      throw e;
    }
  });

  draft.version = blueprint.version + 1;
  const checked = Blueprint.safeParse(draft);
  if (!checked.success) {
    throw new ChangeSetError("invalid", explainIssue(draft, checked.error.issues[0]), undefined, checked.error.issues);
  }

  return {
    blueprint: checked.data,
    inverse: {
      baseVersion: checked.data.version,
      source: "undo",
      summary: cs.summary ? `Undo: ${cs.summary}`.slice(0, 500) : undefined,
      ops: inverseOps.reverse().flat(),
    },
    ops: previews,
    requiresConfirmation: previews.some((p) => p.risk === "risky"),
  };
}

/** Turns a validation issue on the would-be blueprint into a sentence an owner understands. */
export function explainIssue(bp: Blueprint, issue: z.core.$ZodIssue): string {
  const [section, i, ...rest] = issue.path as (string | number)[];
  let where: string | undefined;
  if (section === "pages" && typeof i === "number") {
    const page = bp.pages[i];
    const blockIdx = rest[rest.indexOf("blocks") + 1];
    const block = rest.includes("blocks") && typeof blockIdx === "number"
      ? (rest[0] === "layoutOverrides" ? page?.layoutOverrides?.[rest[1] as LayoutKey]?.blocks[blockIdx] : page?.layout.blocks[blockIdx])
      : undefined;
    const title = typeof block?.options?.title === "string" ? `“${block.options.title}”` : block ? `${block.type}` : undefined;
    where = block ? `the ${title} block on page “${page?.label}”` : page ? `page “${page.label}”` : undefined;
  } else if (section === "automations" && typeof i === "number") {
    where = bp.automations[i] ? `automation “${bp.automations[i].label}”` : undefined;
  } else if (section === "tables" && typeof i === "number") {
    const t = bp.tables[i];
    const fieldIdx = rest[0] === "fields" ? rest[1] : undefined;
    const f = typeof fieldIdx === "number" ? t?.fields[fieldIdx] : undefined;
    where = f ? `field “${f.label}” on “${t.label}”` : t ? `table “${t.label}”` : undefined;
  }
  if (/^(unknown (table|field)|links to unknown table|rollup must)/.test(issue.message) && where) {
    return `That can’t be removed yet: ${where} still uses it. Change or remove that first.`;
  }
  if (/duplicate/.test(issue.message)) return `Something with that name already exists${where ? ` (${where})` : ""}.`;
  if (/columns/.test(issue.message) && where) return `${where[0].toUpperCase()}${where.slice(1)} doesn’t fit the 12-column grid.`;
  return `That change doesn’t work${where ? ` for ${where}` : ""}: ${issue.message}.`;
}

// ---------- lookups ----------

function notFound(what: string): never {
  throw new ChangeSetError("not_found", `${what} not found`);
}

function exists(what: string): never {
  throw new ChangeSetError("invalid", `${what} already exists`);
}

const tableOf = (bp: Blueprint, id: string) => bp.tables.find((t) => t.id === id) ?? notFound(`Table ${id}`);
const pageOf = (bp: Blueprint, id: string) => bp.pages.find((p) => p.id === id) ?? notFound(`Page ${id}`);
const automationOf = (bp: Blueprint, id: string) =>
  bp.automations.find((a) => a.id === id) ?? notFound(`Automation ${id}`);

function fieldOf(bp: Blueprint, tableId: string, fieldId: string) {
  return tableOf(bp, tableId).fields.find((f) => f.id === fieldId) ?? notFound(`Field ${fieldId} on ${tableId}`);
}

function blocksOf(page: Page, layout: LayoutKey | undefined): Block[] {
  if (!layout) return page.layout.blocks;
  return page.layoutOverrides?.[layout]?.blocks ?? notFound(`Layout ${layout} on page ${page.id}`);
}

function blockOf(page: Page, layout: LayoutKey | undefined, blockId: string): Block {
  return blocksOf(page, layout).find((b) => b.id === blockId) ?? notFound(`Block ${blockId}`);
}

function indexOrThrow<T extends { id: string }>(arr: T[], id: string, what: string): number {
  const i = arr.findIndex((x) => x.id === id);
  if (i < 0) notFound(`${what} ${id}`);
  return i;
}

function insertAt<T>(arr: T[], item: T, index: number | undefined) {
  const i = index === undefined ? arr.length : Math.min(index, arr.length);
  arr.splice(i, 0, item);
}

function setOverride(page: Page, layout: LayoutKey, blocks: Block[] | null) {
  if (blocks) {
    page.layoutOverrides = { ...page.layoutOverrides, [layout]: { blocks } };
  } else if (page.layoutOverrides) {
    delete page.layoutOverrides[layout];
    if (Object.keys(page.layoutOverrides).length === 0) delete page.layoutOverrides;
  }
}

function menuOrderIds(bp: Blueprint): string[] {
  return bp.pages
    .map((p, i) => ({ id: p.id, order: p.menuOrder, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((p) => p.id);
}

// ---------- apply ----------

/** Mutates `bp` and returns the ops that undo this one. */
function applyOp(bp: Blueprint, op: Operation): Operation[] {
  switch (op.op) {
    case "rename": {
      const t = op.target;
      const obj =
        t.kind === "table"
          ? tableOf(bp, t.tableId)
          : t.kind === "field"
            ? fieldOf(bp, t.tableId, t.fieldId)
            : t.kind === "page"
              ? pageOf(bp, t.pageId)
              : automationOf(bp, t.automationId);
      const old = obj.label;
      obj.label = op.label;
      return [{ op: "rename", target: t, label: old }];
    }

    case "updateBusiness": {
      const old: Partial<Blueprint["business"]> = {};
      for (const key of Object.keys(op.business) as (keyof Blueprint["business"])[]) {
        const value = op.business[key];
        if (value === undefined) continue;
        old[key] = bp.business[key];
        bp.business[key] = value;
      }
      return [{ op: "updateBusiness", business: old }];
    }

    case "addTable": {
      if (bp.tables.some((t) => t.id === op.table.id)) exists(`Table ${op.table.id}`);
      insertAt(bp.tables, structuredClone(op.table), op.index);
      return [{ op: "removeTable", tableId: op.table.id }];
    }
    case "removeTable": {
      const i = indexOrThrow(bp.tables, op.tableId, "Table");
      const [table] = bp.tables.splice(i, 1);
      return [{ op: "addTable", table, index: i }];
    }

    case "addField": {
      const table = tableOf(bp, op.tableId);
      if (table.fields.some((f) => f.id === op.field.id)) exists(`Field ${op.field.id}`);
      insertAt(table.fields, structuredClone(op.field), op.index);
      return [{ op: "removeField", tableId: op.tableId, fieldId: op.field.id }];
    }
    case "removeField": {
      const table = tableOf(bp, op.tableId);
      const i = indexOrThrow(table.fields, op.fieldId, "Field");
      const [field] = table.fields.splice(i, 1);
      return [{ op: "addField", tableId: op.tableId, field, index: i }];
    }
    case "updateField": {
      const table = tableOf(bp, op.tableId);
      const i = indexOrThrow(table.fields, op.field.id, "Field");
      const old = table.fields[i];
      table.fields[i] = structuredClone(op.field);
      return [{ op: "updateField", tableId: op.tableId, field: old }];
    }

    case "addPage": {
      if (bp.pages.some((p) => p.id === op.page.id)) exists(`Page ${op.page.id}`);
      insertAt(bp.pages, structuredClone(op.page), op.index);
      return [{ op: "removePage", pageId: op.page.id }];
    }
    case "removePage": {
      const i = indexOrThrow(bp.pages, op.pageId, "Page");
      const [page] = bp.pages.splice(i, 1);
      return [{ op: "addPage", page, index: i }];
    }
    case "setPageHidden": {
      const page = pageOf(bp, op.pageId);
      const old = page.hidden;
      page.hidden = op.hidden;
      return [{ op: "setPageHidden", pageId: op.pageId, hidden: old }];
    }
    case "setPageIcon": {
      const page = pageOf(bp, op.pageId);
      const old = page.icon ?? null;
      if (op.icon === null) delete page.icon;
      else page.icon = op.icon;
      return [{ op: "setPageIcon", pageId: op.pageId, icon: old }];
    }
    case "reorderPages": {
      const current = menuOrderIds(bp);
      const wanted = new Set(op.pageIds);
      if (wanted.size !== op.pageIds.length || wanted.size !== current.length || current.some((id) => !wanted.has(id))) {
        throw new ChangeSetError("invalid", "reorderPages must list every page exactly once");
      }
      op.pageIds.forEach((id, i) => (pageOf(bp, id).menuOrder = i));
      return [{ op: "reorderPages", pageIds: current }];
    }

    case "addBlock": {
      const page = pageOf(bp, op.pageId);
      const blocks = blocksOf(page, op.layout);
      if (blocks.some((b) => b.id === op.block.id)) exists(`Block ${op.block.id}`);
      insertAt(blocks, structuredClone(op.block), op.index);
      return [{ op: "removeBlock", pageId: op.pageId, blockId: op.block.id, layout: op.layout }];
    }
    case "removeBlock": {
      const blocks = blocksOf(pageOf(bp, op.pageId), op.layout);
      const i = indexOrThrow(blocks, op.blockId, "Block");
      const [block] = blocks.splice(i, 1);
      return [{ op: "addBlock", pageId: op.pageId, block, index: i, layout: op.layout }];
    }
    case "updateBlock": {
      const blocks = blocksOf(pageOf(bp, op.pageId), op.layout);
      const i = indexOrThrow(blocks, op.block.id, "Block");
      const old = blocks[i];
      blocks[i] = structuredClone(op.block);
      return [{ op: "updateBlock", pageId: op.pageId, block: old, layout: op.layout }];
    }
    case "moveBlock": {
      const block = blockOf(pageOf(bp, op.pageId), op.layout, op.blockId);
      const { x, y } = block;
      block.x = op.x;
      block.y = op.y;
      return [{ op: "moveBlock", pageId: op.pageId, blockId: op.blockId, x, y, layout: op.layout }];
    }
    case "resizeBlock": {
      const block = blockOf(pageOf(bp, op.pageId), op.layout, op.blockId);
      const { w, h } = block;
      block.w = op.w;
      block.h = op.h;
      return [{ op: "resizeBlock", pageId: op.pageId, blockId: op.blockId, w, h, layout: op.layout }];
    }
    case "createLayoutOverride": {
      const page = pageOf(bp, op.pageId);
      if (page.layoutOverrides?.[op.layout]) exists(`Layout ${op.layout} on page ${op.pageId}`);
      setOverride(page, op.layout, structuredClone(page.layout.blocks));
      return [{ op: "removeLayoutOverride", pageId: op.pageId, layout: op.layout }];
    }
    case "removeLayoutOverride": {
      const page = pageOf(bp, op.pageId);
      const old = blocksOf(page, op.layout);
      setOverride(page, op.layout, null);
      return [{ op: "setLayoutOverride", pageId: op.pageId, layout: op.layout, blocks: old }];
    }
    case "setLayoutOverride": {
      const page = pageOf(bp, op.pageId);
      const old = page.layoutOverrides?.[op.layout]?.blocks ?? null;
      setOverride(page, op.layout, op.blocks && structuredClone(op.blocks));
      return [{ op: "setLayoutOverride", pageId: op.pageId, layout: op.layout, blocks: old }];
    }

    case "setScheduling": {
      const old = bp.scheduling ?? null;
      if (op.scheduling) bp.scheduling = structuredClone(op.scheduling);
      else delete bp.scheduling;
      return [{ op: "setScheduling", scheduling: old }];
    }

    case "addAutomation": {
      if (bp.automations.some((a) => a.id === op.automation.id)) exists(`Automation ${op.automation.id}`);
      insertAt(bp.automations, structuredClone(op.automation), op.index);
      return [{ op: "removeAutomation", automationId: op.automation.id }];
    }
    case "removeAutomation": {
      const i = indexOrThrow(bp.automations, op.automationId, "Automation");
      const [automation] = bp.automations.splice(i, 1);
      return [{ op: "addAutomation", automation, index: i }];
    }
    case "updateAutomation": {
      const i = indexOrThrow(bp.automations, op.automation.id, "Automation");
      const old = bp.automations[i];
      bp.automations[i] = structuredClone(op.automation);
      return [{ op: "updateAutomation", automation: old }];
    }
    case "putComponent": {
      bp.components ??= [];
      const i = bp.components.findIndex((c) => c.id === op.component.id);
      if (i >= 0) {
        const old = bp.components[i];
        bp.components[i] = structuredClone(op.component);
        return [{ op: "putComponent", component: old }];
      }
      bp.components.push(structuredClone(op.component));
      return [{ op: "removeComponent", componentId: op.component.id }];
    }
    case "removeComponent": {
      const i = (bp.components ?? []).findIndex((c) => c.id === op.componentId);
      if (i < 0) throw new ChangeSetError("not_found", `Component ${op.componentId} not found`);
      const usedOn = bp.pages.find((p) =>
        [p.layout.blocks, ...Object.values(p.layoutOverrides ?? {}).map((o) => o?.blocks ?? [])].some((bs) => bs.some((b) => b.type === "custom" && b.options?.component === op.componentId)),
      );
      if (usedOn) throw new ChangeSetError("invalid", `Component ${op.componentId} is still shown on page ${usedOn.label}`);
      const [component] = bp.components!.splice(i, 1);
      if (!bp.components!.length) delete bp.components;
      return [{ op: "putComponent", component }];
    }
    case "toggleAutomation": {
      const a = automationOf(bp, op.automationId);
      const old = a.enabled;
      a.enabled = op.enabled;
      return [{ op: "toggleAutomation", automationId: op.automationId, enabled: old }];
    }
  }
}

// ---------- descriptions (for previews and confirmations) ----------

const q = (s: string) => `“${s}”`;

function labelOrId<T extends { id: string; label: string }>(arr: T[], id: string) {
  const found = arr.find((x) => x.id === id);
  return found ? q(found.label) : id;
}

function describe(bp: Blueprint, op: Operation): string {
  const table = (id: string) => labelOrId(bp.tables, id);
  const page = (id: string) => labelOrId(bp.pages, id);
  const auto = (id: string) => labelOrId(bp.automations, id);
  const where = (layout?: LayoutKey) => (layout ? ` (${layoutName(layout)} layout)` : "");

  switch (op.op) {
    case "rename": {
      const t = op.target;
      const old =
        t.kind === "table"
          ? table(t.tableId)
          : t.kind === "field"
            ? labelOrId(bp.tables.find((x) => x.id === t.tableId)?.fields ?? [], t.fieldId)
            : t.kind === "page"
              ? page(t.pageId)
              : auto(t.automationId);
      return `Rename ${t.kind} ${old} to ${q(op.label)}`;
    }
    case "updateBusiness":
      return `Update business details (${Object.keys(op.business).join(", ")})`;
    case "addTable":
      return `Add table ${q(op.table.label)}`;
    case "removeTable":
      return `Remove table ${table(op.tableId)}`;
    case "addField":
      return `Add field ${q(op.field.label)} to ${table(op.tableId)}`;
    case "removeField":
      return `Remove field ${labelOrId(bp.tables.find((t) => t.id === op.tableId)?.fields ?? [], op.fieldId)} from ${table(op.tableId)}`;
    case "updateField":
      return `Change field ${q(op.field.label)} on ${table(op.tableId)}`;
    case "addPage":
      return `Add page ${q(op.page.label)}`;
    case "removePage":
      return `Remove page ${page(op.pageId)}`;
    case "setPageHidden":
      return `${op.hidden ? "Hide" : "Show"} page ${page(op.pageId)}`;
    case "setPageIcon":
      return `Change icon of page ${page(op.pageId)}`;
    case "reorderPages":
      return "Reorder menu";
    case "addBlock":
      return `Add ${op.block.type} block to ${page(op.pageId)}${where(op.layout)}`;
    case "removeBlock":
      return `Remove a block from ${page(op.pageId)}${where(op.layout)}`;
    case "updateBlock":
      return `Change a ${op.block.type} block on ${page(op.pageId)}${where(op.layout)}`;
    case "moveBlock":
      return `Move a block on ${page(op.pageId)}${where(op.layout)}`;
    case "resizeBlock":
      return `Resize a block on ${page(op.pageId)}${where(op.layout)}`;
    case "createLayoutOverride":
      return `Create a separate ${layoutName(op.layout)} layout for ${page(op.pageId)}`;
    case "removeLayoutOverride":
      return `Remove the ${layoutName(op.layout)} layout of ${page(op.pageId)}`;
    case "setLayoutOverride":
      return op.blocks
        ? `Set up a separate ${layoutName(op.layout)} layout for ${page(op.pageId)}`
        : `Remove the ${layoutName(op.layout)} layout of ${page(op.pageId)}`;
    case "setScheduling":
      return op.scheduling ? "Change booking settings (hours, rules, deposits)" : "Turn off online booking setup";
    case "addAutomation":
      return `Add automation ${q(op.automation.label)}`;
    case "removeAutomation":
      return `Remove automation ${auto(op.automationId)}`;
    case "updateAutomation":
      return `Change automation ${q(op.automation.label)}`;
    case "toggleAutomation":
      return `${op.enabled ? "Turn on" : "Turn off"} automation ${auto(op.automationId)}`;
    case "putComponent":
      return (bp.components ?? []).some((c) => c.id === op.component.id) ? `Update custom component ${q(op.component.label)}` : `Add custom component ${q(op.component.label)}`;
    case "removeComponent":
      return `Remove custom component ${labelOrId(bp.components ?? [], op.componentId)}`;
  }
}
