import { z } from "zod";

/**
 * The blueprint is a business's whole configuration: tables, fields, pages, layouts,
 * automations and connections. It is data, never code. See docs/architecture.md.
 *
 * Ids are stable and never shown to users; labels are free, editable text.
 */

// ---------- ids ----------

const idPattern = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[a-z0-9_]{1,60}$`), `must look like ${prefix}_something (lowercase, digits, _)`);

export const TableId = idPattern("tbl");
export const FieldId = idPattern("fld");
export const PageId = idPattern("pg");
export const BlockId = idPattern("blk");
export const AutomationId = idPattern("aut");
export const ConnectionId = idPattern("con");

export const Label = z.string().trim().min(1).max(80);

// ---------- fields ----------

export const FIELD_TYPES = [
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "datetime",
  "status",
  "choice",
  "person",
  "link",
  "file",
  "checkbox",
  "phone",
  "email",
  "formula",
  "rollup",
] as const;
export const FieldType = z.enum(FIELD_TYPES);
export type FieldType = z.infer<typeof FieldType>;

const ChoiceOption = z.strictObject({
  id: z.string().regex(/^opt_[a-z0-9_]{1,60}$/),
  label: Label,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const fieldBase = {
  id: FieldId,
  label: Label,
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
};

const SimpleField = z.strictObject({
  ...fieldBase,
  type: z.enum([
    "text",
    "long_text",
    "number",
    "date",
    "datetime",
    "person",
    "file",
    "checkbox",
    "phone",
    "email",
  ]),
});

const MoneyField = z.strictObject({
  ...fieldBase,
  type: z.literal("money"),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

const ChoiceField = z.strictObject({
  ...fieldBase,
  type: z.enum(["status", "choice"]),
  options: z.array(ChoiceOption).min(1),
  multiple: z.boolean().optional(),
});

const LinkField = z.strictObject({
  ...fieldBase,
  type: z.literal("link"),
  to: TableId,
  multiple: z.boolean().optional(),
});

const FormulaField = z.strictObject({
  ...fieldBase,
  type: z.literal("formula"),
  expression: z.string().min(1).max(2000),
});

const RollupField = z.strictObject({
  ...fieldBase,
  type: z.literal("rollup"),
  via: FieldId, // a link field on this table
  field: FieldId, // field on the linked table
  agg: z.enum(["sum", "count", "avg", "min", "max"]),
});

export const Field = z.discriminatedUnion("type", [
  SimpleField,
  MoneyField,
  ChoiceField,
  LinkField,
  FormulaField,
  RollupField,
]);
export type Field = z.infer<typeof Field>;

export const Table = z.strictObject({
  id: TableId,
  label: Label,
  fields: z.array(Field),
  primaryField: FieldId.optional(),
});
export type Table = z.infer<typeof Table>;

// ---------- layout ----------

export const GRID_COLUMNS = 12;

export const BLOCK_TYPES = [
  "table",
  "board",
  "calendar",
  "gallery",
  "form",
  "number",
  "chart",
  "list",
  "messages",
  "buttons",
  "notes",
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const DataSource = z.strictObject({
  table: TableId,
  filter: z.string().max(500).optional(),
  sort: z
    .array(z.strictObject({ field: FieldId, dir: z.enum(["asc", "desc"]) }))
    .optional(),
  groupBy: FieldId.optional(),
  agg: z.enum(["sum", "count", "avg", "min", "max"]).optional(),
  field: FieldId.optional(),
});
export type DataSource = z.infer<typeof DataSource>;

export const Block = z
  .strictObject({
    id: BlockId,
    type: BlockType,
    source: DataSource.optional(),
    x: z.int().min(0).max(GRID_COLUMNS - 1),
    y: z.int().min(0),
    w: z.int().min(1).max(GRID_COLUMNS),
    h: z.int().min(1).max(50),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((b) => b.x + b.w <= GRID_COLUMNS, {
    message: `block must fit in ${GRID_COLUMNS} columns (x + w <= ${GRID_COLUMNS})`,
    path: ["w"],
  });
export type Block = z.infer<typeof Block>;

export const Layout = z.strictObject({
  columns: z.literal(GRID_COLUMNS),
  blocks: z.array(Block),
});
export type Layout = z.infer<typeof Layout>;

/** `device:phone|tablet|desktop` or `user:<uuid>` */
export const LayoutKey = z.union([
  z.enum(["device:phone", "device:tablet", "device:desktop"]),
  z.templateLiteral(["user:", z.uuid()]),
]);
export type LayoutKey = z.infer<typeof LayoutKey>;

export const Page = z.strictObject({
  id: PageId,
  label: Label,
  icon: z.string().max(40).optional(),
  menuOrder: z.int().min(0),
  hidden: z.boolean(),
  layout: Layout,
  layoutOverrides: z.partialRecord(LayoutKey, z.strictObject({ blocks: z.array(Block) })).optional(),
});
export type Page = z.infer<typeof Page>;

// ---------- automations ----------

export const TRIGGER_TYPES = [
  "record_created",
  "record_updated",
  "status_changed",
  "date_reached",
  "schedule",
  "form_submitted",
  "message_received",
  "connector_event",
  "button_pressed",
] as const;

export const ACTION_TYPES = [
  "create_record",
  "update_record",
  "send_message",
  "notify",
  "assign",
  "generate_document",
  "call_connector",
  "wait",
  "ai_step",
  "approval",
] as const;

export const Trigger = z.looseObject({
  type: z.enum(TRIGGER_TYPES),
  table: TableId.optional(),
  field: FieldId.optional(),
});

export const Condition = z.strictObject({
  field: FieldId,
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"]),
  value: z.unknown().optional(),
});

export const Action = z.looseObject({
  type: z.enum(ACTION_TYPES),
});

export const Automation = z.strictObject({
  id: AutomationId,
  label: Label,
  enabled: z.boolean(),
  trigger: Trigger,
  conditions: z.array(Condition),
  actions: z.array(Action).min(1),
});
export type Automation = z.infer<typeof Automation>;

// ---------- connections / modules ----------

export const Connection = z.strictObject({
  id: ConnectionId,
  provider: z.enum(["stripe", "resend", "twilio", "google_calendar", "square", "etsy"]),
  status: z.enum(["not_connected", "pending", "connected", "error"]),
});
export type Connection = z.infer<typeof Connection>;

export const MODULES = ["bookings", "payments", "messaging", "orders", "inventory", "documents"] as const;
export const Module = z.enum(MODULES);

// ---------- blueprint ----------

export const BusinessInfo = z.strictObject({
  name: Label,
  type: z.string().regex(/^[a-z0-9_]{1,40}$/),
  timezone: z.string().min(1).max(64),
});

const BlueprintShape = z.strictObject({
  version: z.int().min(1),
  business: BusinessInfo,
  tables: z.array(Table),
  pages: z.array(Page),
  automations: z.array(Automation),
  connections: z.array(Connection),
  modules: z.array(Module),
});

/** Full blueprint with referential-integrity checks. */
export const Blueprint = BlueprintShape.superRefine((bp, ctx) => {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  // Unique ids across the whole document (fields are unique per table).
  const seen = new Set<string>();
  const claim = (id: string, path: (string | number)[]) => {
    if (seen.has(id)) issue(path, `duplicate id ${id}`);
    seen.add(id);
  };

  const tables = new Map(bp.tables.map((t) => [t.id, t]));
  const fieldsOf = (tableId: string) => new Set(tables.get(tableId)?.fields.map((f) => f.id) ?? []);

  bp.tables.forEach((t, ti) => {
    claim(t.id, ["tables", ti, "id"]);
    const fieldIds = new Set<string>();
    t.fields.forEach((f, fi) => {
      if (fieldIds.has(f.id)) issue(["tables", ti, "fields", fi, "id"], `duplicate field id ${f.id}`);
      fieldIds.add(f.id);
      if (f.type === "link" && !tables.has(f.to)) {
        issue(["tables", ti, "fields", fi, "to"], `links to unknown table ${f.to}`);
      }
    });
    t.fields.forEach((f, fi) => {
      if (f.type !== "rollup") return;
      const via = t.fields.find((x) => x.id === f.via);
      if (!via || via.type !== "link") {
        issue(["tables", ti, "fields", fi, "via"], `rollup must go via a link field on ${t.id}`);
      } else if (!fieldsOf(via.to).has(f.field)) {
        issue(["tables", ti, "fields", fi, "field"], `unknown field ${f.field} on ${via.to}`);
      }
    });
    if (t.primaryField && !fieldIds.has(t.primaryField)) {
      issue(["tables", ti, "primaryField"], `unknown field ${t.primaryField}`);
    }
  });

  const checkSource = (src: DataSource | undefined, path: (string | number)[]) => {
    if (!src) return;
    if (!tables.has(src.table)) return issue([...path, "table"], `unknown table ${src.table}`);
    const fields = fieldsOf(src.table);
    if (src.groupBy && !fields.has(src.groupBy)) issue([...path, "groupBy"], `unknown field ${src.groupBy}`);
    if (src.field && !fields.has(src.field)) issue([...path, "field"], `unknown field ${src.field}`);
    src.sort?.forEach((s, i) => {
      if (!fields.has(s.field)) issue([...path, "sort", i, "field"], `unknown field ${s.field}`);
    });
  };

  const checkBlocks = (blocks: Block[], path: (string | number)[], claimIds: boolean) => {
    const local = new Set<string>();
    blocks.forEach((b, bi) => {
      if (claimIds) claim(b.id, [...path, bi, "id"]);
      else if (local.has(b.id)) issue([...path, bi, "id"], `duplicate block id ${b.id}`);
      local.add(b.id);
      checkSource(b.source, [...path, bi, "source"]);
    });
  };

  bp.pages.forEach((p, pi) => {
    claim(p.id, ["pages", pi, "id"]);
    checkBlocks(p.layout.blocks, ["pages", pi, "layout", "blocks"], true);
    for (const [key, override] of Object.entries(p.layoutOverrides ?? {})) {
      // Override blocks may reuse ids from the default layout (same block, different position).
      if (override) checkBlocks(override.blocks, ["pages", pi, "layoutOverrides", key, "blocks"], false);
    }
  });

  bp.automations.forEach((a, ai) => {
    claim(a.id, ["automations", ai, "id"]);
    if (a.trigger.table && !tables.has(a.trigger.table)) {
      issue(["automations", ai, "trigger", "table"], `unknown table ${a.trigger.table}`);
    }
    if (a.trigger.table && a.trigger.field && !fieldsOf(a.trigger.table).has(a.trigger.field)) {
      issue(["automations", ai, "trigger", "field"], `unknown field ${a.trigger.field}`);
    }
  });

  bp.connections.forEach((c, ci) => claim(c.id, ["connections", ci, "id"]));
});
export type Blueprint = z.infer<typeof Blueprint>;

/** A minimal valid blueprint for a brand-new business. */
export function emptyBlueprint(business: z.infer<typeof BusinessInfo>): Blueprint {
  return Blueprint.parse({
    version: 1,
    business,
    tables: [],
    pages: [
      {
        id: "pg_home",
        label: "Home",
        icon: "home",
        menuOrder: 0,
        hidden: false,
        layout: { columns: GRID_COLUMNS, blocks: [] },
      },
    ],
    automations: [],
    connections: [],
    modules: [],
  });
}
