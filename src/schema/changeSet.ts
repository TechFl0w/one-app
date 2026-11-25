import { z } from "zod";
import {
  Automation,
  AutomationId,
  Block,
  BlockId,
  BusinessInfo,
  Component,
  ComponentId,
  Field,
  FieldId,
  Label,
  LayoutKey,
  Page,
  PageId,
  Scheduling,
  Table,
  TableId,
} from "./blueprint";

/**
 * A change set is the only way a blueprint changes. UI edits (Edit mode) and AI edits both
 * produce one; it is previewed, then applied via `applyChangeSet`. See docs/architecture.md §2.
 */

/** Which layout a block op targets. Omitted = the page's default layout. */
const layoutTarget = { layout: LayoutKey.optional() };

export const RenameTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("table"), tableId: TableId }),
  z.strictObject({ kind: z.literal("field"), tableId: TableId, fieldId: FieldId }),
  z.strictObject({ kind: z.literal("page"), pageId: PageId }),
  z.strictObject({ kind: z.literal("automation"), automationId: AutomationId }),
]);
export type RenameTarget = z.infer<typeof RenameTarget>;

export const Operation = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("rename"), target: RenameTarget, label: Label }),
  z.strictObject({ op: z.literal("updateBusiness"), business: BusinessInfo.partial() }),

  z.strictObject({ op: z.literal("addTable"), table: Table, index: z.int().min(0).optional() }),
  z.strictObject({ op: z.literal("removeTable"), tableId: TableId }),

  z.strictObject({ op: z.literal("addField"), tableId: TableId, field: Field, index: z.int().min(0).optional() }),
  z.strictObject({ op: z.literal("removeField"), tableId: TableId, fieldId: FieldId }),
  z.strictObject({ op: z.literal("updateField"), tableId: TableId, field: Field }),

  z.strictObject({ op: z.literal("addPage"), page: Page, index: z.int().min(0).optional() }),
  z.strictObject({ op: z.literal("removePage"), pageId: PageId }),
  z.strictObject({ op: z.literal("setPageHidden"), pageId: PageId, hidden: z.boolean() }),
  z.strictObject({ op: z.literal("setPageIcon"), pageId: PageId, icon: z.string().max(40).nullable() }),
  /** Full menu order: every page id, in the new order. */
  z.strictObject({ op: z.literal("reorderPages"), pageIds: z.array(PageId).min(1) }),

  z.strictObject({ op: z.literal("addBlock"), pageId: PageId, block: Block, index: z.int().min(0).optional(), ...layoutTarget }),
  z.strictObject({ op: z.literal("removeBlock"), pageId: PageId, blockId: BlockId, ...layoutTarget }),
  z.strictObject({ op: z.literal("updateBlock"), pageId: PageId, block: Block, ...layoutTarget }),
  z.strictObject({ op: z.literal("moveBlock"), pageId: PageId, blockId: BlockId, x: z.int().min(0), y: z.int().min(0), ...layoutTarget }),
  z.strictObject({ op: z.literal("resizeBlock"), pageId: PageId, blockId: BlockId, w: z.int().min(1), h: z.int().min(1), ...layoutTarget }),
  /** Copies the default layout into an override so it can be edited separately. */
  z.strictObject({ op: z.literal("createLayoutOverride"), pageId: PageId, layout: LayoutKey }),
  /** Drops an override; that device/user falls back to the default layout. */
  z.strictObject({ op: z.literal("removeLayoutOverride"), pageId: PageId, layout: LayoutKey }),

  z.strictObject({ op: z.literal("addAutomation"), automation: Automation, index: z.int().min(0).optional() }),
  z.strictObject({ op: z.literal("removeAutomation"), automationId: AutomationId }),
  z.strictObject({ op: z.literal("updateAutomation"), automation: Automation }),
  z.strictObject({ op: z.literal("toggleAutomation"), automationId: AutomationId, enabled: z.boolean() }),

  /** Replace the booking setup (roles, hours, rules, deposit, statuses); null removes it. */
  z.strictObject({ op: z.literal("setScheduling"), scheduling: Scheduling.nullable() }),

  /** Add or replace a generated component (source + server-compiled code). */
  z.strictObject({ op: z.literal("putComponent"), component: Component }),
  /** Remove a generated component; fails while a block still shows it. */
  z.strictObject({ op: z.literal("removeComponent"), componentId: ComponentId }),

  /** Restore a whole layout override exactly (used by undo of removeLayoutOverride). */
  z.strictObject({
    op: z.literal("setLayoutOverride"),
    pageId: PageId,
    layout: LayoutKey,
    blocks: z.array(Block).nullable(),
  }),
]);
export type Operation = z.infer<typeof Operation>;
export type OpName = Operation["op"];

export const ChangeSource = z.enum(["ui", "ai", "undo", "system"]);
export type ChangeSource = z.infer<typeof ChangeSource>;

export const ChangeSet = z.strictObject({
  /** Blueprint version this change set was built against (optimistic concurrency). */
  baseVersion: z.int().min(1),
  source: ChangeSource,
  summary: z.string().max(500).optional(),
  ops: z.array(Operation).min(1).max(500),
});
export type ChangeSet = z.infer<typeof ChangeSet>;

/**
 * Risk per operation. Risky ops need explicit confirmation (CLAUDE.md rule 5):
 * deleting data and changing automations.
 */
export const OP_RISK: Record<OpName, "safe" | "risky"> = {
  rename: "safe",
  updateBusiness: "safe",
  addTable: "safe",
  removeTable: "risky",
  addField: "safe",
  removeField: "risky",
  updateField: "risky",
  addPage: "safe",
  removePage: "safe",
  setPageHidden: "safe",
  setPageIcon: "safe",
  reorderPages: "safe",
  addBlock: "safe",
  removeBlock: "safe",
  updateBlock: "safe",
  moveBlock: "safe",
  resizeBlock: "safe",
  createLayoutOverride: "safe",
  removeLayoutOverride: "safe",
  setLayoutOverride: "safe",
  addAutomation: "risky",
  removeAutomation: "risky",
  updateAutomation: "risky",
  toggleAutomation: "risky",
  setScheduling: "risky",
  putComponent: "safe",
  removeComponent: "safe",
};
