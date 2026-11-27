import { automationIssues } from "@/automations/check";
import { describeStep, planStep } from "@/automations/engine";
import { brokenByChange, describeId } from "@/codegen/references";
import type { z } from "zod";
import { Blueprint, isComputedField, type Automation, type Block, type Field, type LayoutKey, type Page } from "@/schema/blueprint";
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
  /** For the setup window check (tests). */
  now?: Date;
}

/** Deleting what holds data always asks, even while setting up. */
const ALWAYS_ASK = new Set<Operation["op"]>(["removeTable", "removeField", "removeDocument"]);

/**
 * How risky one operation is on this setup. Beyond OP_RISK: changing how a computed value is
 * worked out, renaming a field or adding choices deletes nothing, so it's safe; and while a new
 * business is being set up, setup changes are safe except deleting tables and fields.
 */
export function opRisk(bp: Blueprint, op: Operation, settingUp = false): "safe" | "risky" {
  const base = OP_RISK[op.op];
  if (base === "safe") return "safe";
  if (settingUp && !ALWAYS_ASK.has(op.op)) return "safe";
  if (op.op === "updateField") {
    const before = bp.tables.find((t) => t.id === op.tableId)?.fields.find((f) => f.id === op.field.id);
    if (!before) return base;
    if (isComputedField(before) && isComputedField(op.field)) return "safe";
    if (before.type !== op.field.type) return "risky";
    // Same kind of field: risky only if choices disappear or it becomes required.
    const opts = (f: Field) => ("options" in f && Array.isArray(f.options) ? (f.options as { id: string; label: string }[]) : null);
    const was = opts(before);
    const now = opts(op.field);
    const lost = was && now ? was.some((o) => !now.some((n) => n.id === o.id)) : false;
    const nowRequired = "required" in op.field && op.field.required && !("required" in before && before.required);
    return lost || nowRequired ? "risky" : "safe";
  }
  return base;
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

  const settingUp = !!blueprint.business.setupUntil && Date.parse(blueprint.business.setupUntil) > (opts.now ?? new Date()).getTime();
  cs.ops.forEach((op, i) => {
    try {
      previews.push({ op: op.op, risk: opRisk(draft, op, settingUp), description: describe(draft, op) });
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
  // An automation is checked when it's added or changed, so it can't silently do nothing later.
  for (const op of cs.source === "undo" ? [] : cs.ops) {
    if (op.op !== "addAutomation" && op.op !== "updateAutomation") continue;
    const a = checked.data.automations.find((x) => x.id === op.automation.id);
    const issues = a ? automationIssues(checked.data, a) : [];
    if (issues.length) throw new ChangeSetError("invalid", `The automation “${a!.label}” won't work: ${issues.join("; ")}.`);
  }
  // Never break a live screen: removing something a screen's code uses is refused (rename is fine).
  const broken = brokenByChange(blueprint, checked.data);
  if (broken.length) {
    const b = broken[0];
    throw new ChangeSetError(
      "invalid",
      `${b.ids.map((id) => describeId(blueprint, id)).join(", ")} ${b.ids.length > 1 ? "are" : "is"} still used by the “${b.component}” screen. Change that screen first (the assistant can do it), then remove ${b.ids.length > 1 ? "them" : "it"}.`,
    );
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
    case "setDocument": {
      const docs = (bp.documents ??= []);
      const i = docs.findIndex((d) => d.id === op.document.id);
      const old = i >= 0 ? structuredClone(docs[i]) : null;
      if (i >= 0) docs[i] = op.document;
      else docs.push(op.document);
      return [old ? { op: "setDocument", document: old } : { op: "removeDocument", documentId: op.document.id }];
    }
    case "removeDocument": {
      const docs = bp.documents ?? [];
      const i = docs.findIndex((d) => d.id === op.documentId);
      if (i < 0) throw new ChangeSetError("not_found", `Document ${op.documentId} not found`);
      const [old] = docs.splice(i, 1);
      if (!docs.length) delete bp.documents;
      return [{ op: "setDocument", document: old }];
    }
    case "setPageBadge": {
      const page = pageOf(bp, op.pageId);
      const old = page.badge ? structuredClone(page.badge) : null;
      if (op.badge === null) delete page.badge;
      else page.badge = op.badge;
      return [{ op: "setPageBadge", pageId: op.pageId, badge: old }];
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
    case "setTheme": {
      const old = bp.theme ?? null;
      if (op.theme) bp.theme = structuredClone(op.theme);
      else delete bp.theme;
      return [{ op: "setTheme", theme: old }];
    }
    case "putFunction": {
      bp.functions ??= [];
      const i = bp.functions.findIndex((f) => f.id === op.fn.id);
      if (i >= 0) {
        const old = bp.functions[i];
        bp.functions[i] = structuredClone(op.fn);
        return [{ op: "putFunction", fn: old }];
      }
      bp.functions.push(structuredClone(op.fn));
      return [{ op: "removeFunction", functionId: op.fn.id }];
    }
    case "removeFunction": {
      const i = (bp.functions ?? []).findIndex((f) => f.id === op.functionId);
      if (i < 0) throw new ChangeSetError("not_found", `Function ${op.functionId} not found`);
      const user = bp.automations.find((a) => a.actions.some((x) => x.type === "run_function" && x.function === op.functionId));
      if (user) throw new ChangeSetError("invalid", `Function ${op.functionId} is still used by automation ${user.label}`);
      const [fn] = bp.functions!.splice(i, 1);
      if (!bp.functions!.length) delete bp.functions;
      return [{ op: "putFunction", fn }];
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
      return `Delete ${table(op.tableId)} and everything in it`;
    case "addField":
      return `Add field ${q(op.field.label)} to ${table(op.tableId)}`;
    case "removeField":
      return `Delete ${labelOrId(bp.tables.find((t) => t.id === op.tableId)?.fields ?? [], op.fieldId)} from ${table(op.tableId)} (what's filled in there is lost)`;
    case "updateField": {
      const before = bp.tables.find((t) => t.id === op.tableId)?.fields.find((f) => f.id === op.field.id);
      if (before && isComputedField(before)) return `Change how ${q(op.field.label)} is worked out on ${table(op.tableId)}`;
      const was = before && "options" in before && Array.isArray(before.options) ? (before.options as { id: string; label: string }[]) : null;
      const now = "options" in op.field && Array.isArray(op.field.options) ? (op.field.options as { id: string; label: string }[]) : null;
      if (was && now) {
        const added = now.filter((o) => !was.some((b) => b.id === o.id)).map((o) => q(o.label));
        const gone = was.filter((o) => !now.some((n) => n.id === o.id)).map((o) => q(o.label));
        if (added.length || gone.length) return [added.length ? `Add ${added.join(", ")}` : "", gone.length ? `remove ${gone.join(", ")}` : ""].filter(Boolean).join(" and ") + ` as choices for ${q(op.field.label)} on ${table(op.tableId)}`;
      }
      if (before && before.label !== op.field.label && before.type === op.field.type) return `Rename ${q(before.label)} to ${q(op.field.label)} on ${table(op.tableId)}`;
      return `Change ${q(op.field.label)} on ${table(op.tableId)}${before && before.type !== op.field.type ? ` (from ${before.type} to ${op.field.type})` : ""}`;
    }
    case "addPage":
      return `Add page ${q(op.page.label)}`;
    case "removePage":
      return `Remove page ${page(op.pageId)}`;
    case "setPageHidden":
      return `${op.hidden ? "Hide" : "Show"} page ${page(op.pageId)}`;
    case "setPageIcon":
      return `Change icon of page ${page(op.pageId)}`;
    case "setDocument":
      return `Set up ${q(op.document.label)} (${op.document.kind}) on ${table(op.document.table)}`;
    case "removeDocument":
      return `Remove document ${op.documentId}`;
    case "setPageBadge":
      return `${op.badge ? "Show a count" : "Remove the count"} next to page ${page(op.pageId)}`;
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
    case "setScheduling": {
      if (!op.scheduling) return "Turn off online booking";
      const sc = op.scheduling;
      const deposit = sc.deposit ? (sc.deposit.kind === "percent" ? `a ${sc.deposit.value}% deposit holds the slot` : `a ${sc.deposit.value} ${bp.business.currency ?? ""} deposit holds the slot`.replace("  ", " ")) : "no deposit";
      return `Online booking: open ${hoursInWords(sc.hours)}; ${deposit}${sc.rules.cancelWindowHours ? `; free cancelling up to ${sc.rules.cancelWindowHours} hours before` : ""}`;
    }
    case "addAutomation":
      return `New automatic step ${q(op.automation.label)}: ${automationInWords(bp, op.automation)}`;
    case "removeAutomation":
      return `Remove automation ${auto(op.automationId)}`;
    case "updateAutomation":
      return `Change the automatic step ${q(op.automation.label)}: ${automationInWords(bp, op.automation)}`;
    case "toggleAutomation":
      return `${op.enabled ? "Turn on" : "Turn off"} automation ${auto(op.automationId)}`;
    case "putComponent":
      return (bp.components ?? []).some((c) => c.id === op.component.id) ? `Update screen ${q(op.component.label)}` : `Add screen ${q(op.component.label)}`;
    case "removeComponent":
      return `Remove screen ${labelOrId(bp.components ?? [], op.componentId)}`;
    case "setTheme":
      return op.theme ? "Change the look (colours, fonts, shape)" : "Go back to the standard look";
    case "putFunction": {
      const verb = (bp.functions ?? []).some((f) => f.id === op.fn.id) ? "Update" : "Add";
      return `${verb} background task ${q(op.fn.label)}${op.fn.hosts.length ? ` (connects to ${op.fn.hosts.join(", ")})` : ""}${op.fn.webhook ? ", other services can start it" : ""}`;
    }
    case "removeFunction":
      return `Remove background task ${labelOrId(bp.functions ?? [], op.functionId)}`;
  }
}

const DAY_NAMES: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
/** { mon: [["09:00","17:00"]], … } → "Mon–Fri 09:00–17:00, Sat 10:00–14:00". */
function hoursInWords(h: Record<string, [string, string][] | undefined>): string {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const key = (d: string) => (h[d] ?? []).map(([a, b]) => `${a}–${b}`).join(", ");
  const groups: { from: string; to: string; ranges: string }[] = [];
  for (const d of days) {
    const r = key(d);
    if (!r) continue;
    const last = groups.at(-1);
    if (last && last.ranges === r && days.indexOf(d) === days.indexOf(last.to) + 1) last.to = d;
    else groups.push({ from: d, to: d, ranges: r });
  }
  return groups.length ? groups.map((g) => `${DAY_NAMES[g.from]}${g.to !== g.from ? `–${DAY_NAMES[g.to]}` : ""} ${g.ranges}`).join(", ") : "no days yet";
}

/** "1 day before Start: send the appointment reminder by WhatsApp or email". */
function automationInWords(bp: Blueprint, a: Automation): string {
  const t = bp.tables.find((x) => x.id === a.trigger.table);
  const field = t?.fields.find((f) => f.id === a.trigger.field)?.label;
  const offset = typeof (a.trigger as { offset?: unknown }).offset === "string" ? String((a.trigger as { offset?: string }).offset) : "";
  const thing = t ? t.label.replace(/s$/, "").toLowerCase() : "record";
  const when =
    a.trigger.type === "record_created" ? `when a ${thing} is added` :
    a.trigger.type === "status_changed" ? `when a ${thing}'s ${field ?? "status"} changes` :
    a.trigger.type === "date_reached" ? `${offset ? `${offset.replace(/^-/, "").replace(/d$/, " day(s)").replace(/h$/, " hour(s)")} ${offset.startsWith("-") ? "before" : "after"}` : "on"} the ${field ?? "date"}` :
    a.trigger.type === "record_updated" ? `when a ${thing} changes` : a.trigger.type.replace(/_/g, " ");
  const steps = a.actions.map((x) => describeStep(bp, planStep(x, { tableId: t?.id ?? "", recordId: "", data: {}, automation: a })).replace(/^./, (c) => c.toLowerCase()));
  return `${when}, ${steps.join(", then ")}`;
}
