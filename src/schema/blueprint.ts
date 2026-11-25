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
  "hours",
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
    "hours",
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
  /** A generated component (blueprint.components), rendered in the browser sandbox. */
  "custom",
] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"] as const;
export const FilterOp = z.enum(FILTER_OPS);
export type FilterOp = z.infer<typeof FilterOp>;

/**
 * Date tokens resolved at query time in the business timezone. With `eq` on a date/datetime
 * field, `@today` etc. mean "within that day/week/month".
 */
export const DATE_TOKENS = ["@today", "@tomorrow", "@yesterday", "@this_week", "@this_month", "@now"] as const;

export const BlockFilter = z.strictObject({
  field: FieldId,
  op: FilterOp,
  value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});
export type BlockFilter = z.infer<typeof BlockFilter>;

export const DataSource = z.strictObject({
  table: TableId,
  filters: z.array(BlockFilter).max(20).optional(),
  sort: z
    .array(z.strictObject({ field: z.union([FieldId, z.enum(["_created_at", "_updated_at"])]), dir: z.enum(["asc", "desc"]) }))
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
  op: FilterOp,
  value: z.unknown().optional(),
});

export const Action = z.looseObject({
  type: z.enum(ACTION_TYPES),
});

/**
 * Checks that look beyond the triggering record, evaluated when the job runs.
 * no_upcoming_booking: skip if the client already has a future booking (rebooking nudges).
 */
export const AUTOMATION_GUARDS = ["no_upcoming_booking"] as const;

export const Automation = z.strictObject({
  id: AutomationId,
  label: Label,
  enabled: z.boolean(),
  trigger: Trigger,
  conditions: z.array(Condition),
  guards: z.array(z.enum(AUTOMATION_GUARDS)).optional(),
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
  /** Where review requests send customers (e.g. the Google review link). */
  reviewUrl: z.url({ protocol: /^https$/ }).max(500).optional(),
});

// ---------- scheduling (bookings) ----------

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time like 09:30");
/** Opening/working hours per weekday: { mon: [["09:00","12:00"],["13:00","17:00"]], … }. Missing day = closed. */
export const WeeklyHours = z
  .partialRecord(z.enum(WEEKDAYS), z.array(z.tuple([HHMM, HHMM])).max(6))
  .refine((h) => Object.values(h).every((ranges) => ranges!.every(([a, b]) => a < b)), "each range must end after it starts");
export type WeeklyHours = z.infer<typeof WeeklyHours>;

export const BOOKING_STATES = ["requested", "held", "confirmed", "checked_in", "completed", "paid", "cancelled", "no_show"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

/**
 * Which tables/fields play which role in bookings, plus booking rules. Everything is referenced
 * by id, so owners can rename freely. See docs/booking-engine.md.
 */
export const Scheduling = z.strictObject({
  bookings: z.strictObject({
    table: TableId,
    start: FieldId,
    end: FieldId,
    service: FieldId,
    practitioner: FieldId,
    resource: FieldId.optional(),
    client: FieldId,
    status: FieldId,
    holdUntil: FieldId.optional(),
    amount: FieldId.optional(),
  }),
  services: z.strictObject({
    table: TableId,
    duration: FieldId,
    price: FieldId.optional(),
    bufferBefore: FieldId.optional(),
    bufferAfter: FieldId.optional(),
    /** Link (multiple) to practitioners who can do it; empty = anyone. */
    practitioners: FieldId.optional(),
    /** Choice field matched by option label against resources.type. */
    resourceType: FieldId.optional(),
    /** Checkbox: shown on the public booking page (missing field = all shown). */
    online: FieldId.optional(),
  }),
  practitioners: z.strictObject({ table: TableId, hours: FieldId.optional(), maxPerDay: FieldId.optional(), online: FieldId.optional() }),
  resources: z.strictObject({ table: TableId, type: FieldId.optional() }).optional(),
  timeOff: z.strictObject({ table: TableId, who: FieldId, start: FieldId, end: FieldId }).optional(),
  clients: z.strictObject({ table: TableId, name: FieldId, email: FieldId.optional(), phone: FieldId.optional() }),
  hours: WeeklyHours,
  rules: z.strictObject({
    slotStepMin: z.int().min(5).max(240),
    minNoticeMin: z.int().min(0).max(60 * 24 * 30),
    horizonDays: z.int().min(1).max(365),
    holdMin: z.int().min(1).max(240),
    cancelWindowHours: z.int().min(0).max(24 * 14),
    /** New online bookings start confirmed instead of requested. */
    autoConfirm: z.boolean(),
  }),
  /**
   * Online bookings ask for a deposit (when Stripe is connected): a percent of the price or a
   * fixed amount. The booking is held until paid (needs statuses.held and bookings.holdUntil).
   */
  deposit: z.strictObject({ kind: z.enum(["percent", "fixed"]), value: z.number().positive().max(100_000) }).optional(),
  /** Option ids of the bookings status field for each lifecycle state (unmapped states are unused). */
  statuses: z.partialRecord(z.enum(BOOKING_STATES), z.string().regex(/^opt_[a-z0-9_]{1,60}$/)),
});
export type Scheduling = z.infer<typeof Scheduling>;

// ---------- generated code ----------

export const ComponentId = z.string().regex(/^cmp_[a-z0-9_]{1,60}$/);
export const MAX_COMPONENT_SOURCE = 60_000;
export const MAX_COMPONENT_COMPILED = 120_000;

/**
 * A component the AI wrote for this business (docs/generated-code.md). `source` is the TSX the AI
 * wrote; `compiled` is what our server produced from it (never supplied by the AI).
 */
export const Component = z.strictObject({
  id: ComponentId,
  label: Label,
  source: z.string().min(1).max(MAX_COMPONENT_SOURCE),
  compiled: z.string().min(1).max(MAX_COMPONENT_COMPILED),
});
export type Component = z.infer<typeof Component>;

const BlueprintShape = z.strictObject({
  version: z.int().min(1),
  business: BusinessInfo,
  tables: z.array(Table),
  pages: z.array(Page),
  automations: z.array(Automation),
  connections: z.array(Connection),
  modules: z.array(Module),
  scheduling: Scheduling.optional(),
  components: z.array(Component).max(200).optional(),
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
  const components = new Set((bp.components ?? []).map((c) => c.id));
  (bp.components ?? []).forEach((c, ci) => claim(c.id, ["components", ci, "id"]));
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
    src.filters?.forEach((f, i) => {
      if (!fields.has(f.field)) issue([...path, "filters", i, "field"], `unknown field ${f.field}`);
    });
    src.sort?.forEach((s, i) => {
      if (!s.field.startsWith("_") && !fields.has(s.field)) issue([...path, "sort", i, "field"], `unknown field ${s.field}`);
    });
  };

  const checkBlocks = (blocks: Block[], path: (string | number)[], claimIds: boolean) => {
    const local = new Set<string>();
    blocks.forEach((b, bi) => {
      if (claimIds) claim(b.id, [...path, bi, "id"]);
      else if (local.has(b.id)) issue([...path, bi, "id"], `duplicate block id ${b.id}`);
      local.add(b.id);
      checkSource(b.source, [...path, bi, "source"]);
      if (b.type === "custom") {
        const c = b.options?.component;
        if (typeof c !== "string" || !components.has(c)) issue([...path, bi, "options", "component"], `unknown component ${String(c)}`);
      }
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

  if (bp.scheduling) checkScheduling(bp.scheduling, tables, issue);
});
export type Blueprint = z.infer<typeof Blueprint>;

/** Every role in the scheduling section must point at a real table/field of the right type. */
function checkScheduling(
  sc: Scheduling,
  tables: Map<string, Table>,
  issue: (path: (string | number)[], message: string) => void,
) {
  const role = (path: string[], tableId: string, fieldId: string | undefined, types: Field["type"][], linkTo?: string) => {
    if (!fieldId) return;
    const f = tables.get(tableId)?.fields.find((x) => x.id === fieldId);
    const at = ["scheduling", ...path];
    if (!f) return issue(at, `unknown field ${fieldId}`);
    if (!types.includes(f.type)) return issue(at, `${fieldId} must be ${types.join(" or ")}`);
    if (linkTo && f.type === "link" && f.to !== linkTo) issue(at, `${fieldId} must link to ${linkTo}`);
  };
  const sections = [
    ["bookings", sc.bookings.table],
    ["services", sc.services.table],
    ["practitioners", sc.practitioners.table],
    ["clients", sc.clients.table],
    ...(sc.resources ? [["resources", sc.resources.table]] : []),
    ...(sc.timeOff ? [["timeOff", sc.timeOff.table]] : []),
  ] as const;
  for (const [name, t] of sections) if (!tables.has(t)) issue(["scheduling", name, "table"], `unknown table ${t}`);
  if (sections.some(([, t]) => !tables.has(t))) return;

  const b = sc.bookings;
  role(["bookings", "start"], b.table, b.start, ["datetime"]);
  role(["bookings", "end"], b.table, b.end, ["datetime"]);
  role(["bookings", "service"], b.table, b.service, ["link"], sc.services.table);
  role(["bookings", "practitioner"], b.table, b.practitioner, ["link"], sc.practitioners.table);
  role(["bookings", "client"], b.table, b.client, ["link"], sc.clients.table);
  role(["bookings", "status"], b.table, b.status, ["status", "choice"]);
  role(["bookings", "holdUntil"], b.table, b.holdUntil, ["datetime"]);
  role(["bookings", "amount"], b.table, b.amount, ["money", "number"]);
  if (sc.resources) role(["bookings", "resource"], b.table, b.resource, ["link"], sc.resources.table);
  const s = sc.services;
  role(["services", "duration"], s.table, s.duration, ["number"]);
  role(["services", "price"], s.table, s.price, ["money", "number"]);
  role(["services", "bufferBefore"], s.table, s.bufferBefore, ["number"]);
  role(["services", "bufferAfter"], s.table, s.bufferAfter, ["number"]);
  role(["services", "practitioners"], s.table, s.practitioners, ["link"], sc.practitioners.table);
  role(["services", "resourceType"], s.table, s.resourceType, ["choice", "status"]);
  role(["services", "online"], s.table, s.online, ["checkbox"]);
  role(["practitioners", "hours"], sc.practitioners.table, sc.practitioners.hours, ["hours"]);
  role(["practitioners", "maxPerDay"], sc.practitioners.table, sc.practitioners.maxPerDay, ["number"]);
  role(["practitioners", "online"], sc.practitioners.table, sc.practitioners.online, ["checkbox"]);
  if (sc.resources) role(["resources", "type"], sc.resources.table, sc.resources.type, ["choice", "status"]);
  if (sc.timeOff) {
    role(["timeOff", "who"], sc.timeOff.table, sc.timeOff.who, ["link"], sc.practitioners.table);
    role(["timeOff", "start"], sc.timeOff.table, sc.timeOff.start, ["datetime", "date"]);
    role(["timeOff", "end"], sc.timeOff.table, sc.timeOff.end, ["datetime", "date"]);
  }
  role(["clients", "name"], sc.clients.table, sc.clients.name, ["text"]);
  role(["clients", "email"], sc.clients.table, sc.clients.email, ["email"]);
  role(["clients", "phone"], sc.clients.table, sc.clients.phone, ["phone"]);

  const status = tables.get(b.table)?.fields.find((f) => f.id === b.status);
  if (status && "options" in status) {
    for (const [state, opt] of Object.entries(sc.statuses)) {
      if (!status.options.some((o) => o.id === opt)) issue(["scheduling", "statuses", state], `unknown option ${opt}`);
    }
  }
  if (sc.deposit && (!sc.statuses.held || !b.holdUntil)) {
    issue(["scheduling", "deposit"], "deposits need a held status and a 'held until' field on bookings");
  }
  if (sc.deposit?.kind === "percent" && sc.deposit.value > 100) issue(["scheduling", "deposit", "value"], "a percent can't be over 100");
  for (const req of ["requested", "confirmed", "cancelled"] as const) {
    if (!sc.statuses[req]) issue(["scheduling", "statuses", req], `map the ${req} state to a status option`);
  }
}

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
