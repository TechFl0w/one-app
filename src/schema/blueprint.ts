import { z } from "zod";
import { compiledFormula, formulaFields, FormulaError } from "@/engine/formula";

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
export const DocumentId = idPattern("doc");

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
  /** For number fields: the smallest / largest value allowed. */
  min: z.number().optional(),
  max: z.number().optional(),
  /** For file fields: a gallery (several photos/videos/files) instead of one file. */
  multiple: z.boolean().optional(),
});

const MoneyField = z.strictObject({
  ...fieldBase,
  type: z.literal("money"),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  /** Amounts are never negative unless the field is for credits/refunds and says so. */
  allowNegative: z.boolean().optional(),
  max: z.number().positive().optional(),
});

/**
 * A condition on a record's values (rollup filters, derived statuses). Dates may use "@today",
 * "@now", or "@today+30d" / "@today-7d" (days from today in the business's timezone).
 */
export const RollupWhere = z.strictObject({
  field: FieldId,
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"]),
  value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
});

const OptionId = z.string().regex(/^opt_[a-z0-9_]{1,60}$/);

/**
 * A status that follows the record's own values instead of being set by hand: the first rule
 * whose conditions all hold picks the option, else `otherwise`. Worked out whenever records are
 * read (like rollups), so it can never drift from the dates it describes — e.g. a lease is
 * "upcoming" before its start, "active" while today is inside the term, "ending" in its last 30
 * days and "ended" after. Rules may use other computed fields (rollups) of the same record.
 */
export const DeriveRules = z.strictObject({
  rules: z.array(z.strictObject({ when: z.array(RollupWhere).min(1).max(5), option: OptionId })).min(1).max(12),
  otherwise: OptionId.optional(),
});
export type DeriveRules = z.infer<typeof DeriveRules>;

const ChoiceField = z.strictObject({
  ...fieldBase,
  type: z.enum(["status", "choice"]),
  options: z.array(ChoiceOption).min(1),
  multiple: z.boolean().optional(),
  derive: DeriveRules.optional(),
});

const LinkField = z.strictObject({
  ...fieldBase,
  type: z.literal("link"),
  to: TableId,
  multiple: z.boolean().optional(),
});

/** How a computed number is shown. */
export const NumberFormat = z.enum(["number", "money", "percent"]);

/**
 * A number worked out from the record's other values on every read (src/engine/formula.ts):
 * "fld_qty * fld_unit_price", "fld_total - fld_paid", "round(fld_hours * fld_rate, 2)".
 */
const FormulaField = z.strictObject({
  ...fieldBase,
  type: z.literal("formula"),
  expression: z.string().min(1).max(2000),
  format: NumberFormat.optional(),
});


/**
 * A value computed from linked records whenever records are read (never stored, never stale).
 * Without `from`: `via` is a link field on this table (e.g. a booking's service price).
 * With `from`: the records of table `from` whose link field `via` points at this record (e.g. a
 * room's maintenance jobs). `where` narrows them; `latest` takes `field` from the newest one
 * (by `sortBy`, default when created).
 */
const RollupField = z.strictObject({
  ...fieldBase,
  type: z.literal("rollup"),
  from: TableId.optional(),
  via: FieldId,
  field: FieldId,
  agg: z.enum(["sum", "count", "avg", "min", "max", "latest"]),
  where: z.array(RollupWhere).max(5).optional(),
  sortBy: FieldId.optional(),
  /** How the number shows; by default like the field it adds up (money stays money). */
  format: NumberFormat.optional(),
});

export const Field = z.discriminatedUnion("type", [
  SimpleField,
  MoneyField,
  ChoiceField,
  LinkField,
  FormulaField,
  RollupField,
]);

/** Fields nobody types into: worked out on every read (rollups, formulas, derived statuses). */
export const isComputedField = (f: { type: string; derive?: unknown }) => f.type === "rollup" || f.type === "formula" || !!f.derive;

export type Field = z.infer<typeof Field>;

export const Table = z.strictObject({
  id: TableId,
  label: Label,
  fields: z.array(Field),
  primaryField: FieldId.optional(),
  /** What clicking one of its records does: open the record's own page (default) or a quick edit pop-up (small things like invoice lines). */
  openIn: z.enum(["page", "modal"]).optional(),
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
  /** On a record page: the record's own fields, with Edit. */
  "details",
  /** On a record page of a quote or invoice: the document as the customer sees it, with Send. */
  "document",
  /** On a record page: what happened to the record and the records under it (lines, payments). */
  "activity",
  /** The greeting at the top of a page: hello, today's date, a line of live counts, quick add buttons. */
  "header",
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
  /**
   * A record page: the page every record of this table opens (/r/<table>/<record>). Not in the
   * menu. Its blocks can use the filter value "@record" (e.g. jobs whose vehicle eq @record),
   * a "details" block shows the record, and generated components get useProps().recordId.
   */
  recordOf: TableId.optional(),
  /** A live count next to the page in the menu ("4", "1 late"): records matching source.filters. */
  badge: z
    .strictObject({
      source: DataSource,
      /** Shown after the number ("late", "low"). */
      label: z.string().max(20).optional(),
      tone: z.lazy(() => Tone).optional(),
    })
    .optional(),
});
export type Page = z.infer<typeof Page>;

/** Colour families blocks and badges use (KPI tiles, list headers, menu counts). */
export const TONES = ["accent", "red", "amber", "blue", "purple", "neutral"] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

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
  /** Run a generated server function (blueprint.functions) with the record. */
  "run_function",
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
  /** ISO 4217 code used for prices without their own currency (e.g. CAD, USD, EUR). */
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
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
  /** Tailwind CSS for the classes it uses, built at save; without it the frame compiles in the browser. */
  css: z.string().max(200_000).optional(),
});
export type Component = z.infer<typeof Component>;

// ---------- theme ----------

/** Google Fonts the app can switch to (loaded on demand). */
export const THEME_FONTS = ["Plus Jakarta Sans", "Inter", "DM Sans", "Manrope", "Outfit", "Poppins", "Nunito", "Work Sans", "Space Grotesk", "Lora", "Playfair Display", "Fraunces", "DM Serif Display", "Libre Baskerville"] as const;
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour like #17694F");

/** The business's look: colours, fonts and shape. Applies to the app and to generated components. */
export const Theme = z.strictObject({
  colors: z
    .strictObject({ ground: Hex, card: Hex, ink: Hex, muted: Hex, line: Hex, accent: Hex, accentHover: Hex, accentTint: Hex })
    .partial()
    .optional(),
  font: z.enum(THEME_FONTS).optional(),
  headingFont: z.enum(THEME_FONTS).optional(),
  /** Card corner radius in px (buttons stay pills unless squareButtons). */
  radius: z.int().min(0).max(32).optional(),
  squareButtons: z.boolean().optional(),
  /** Where the page menu lives: a sidebar (default), a bar along the top, or only a menu button. */
  menu: z.enum(["side", "top", "minimal"]).optional(),
});
export type Theme = z.infer<typeof Theme>;

export const FunctionId = z.string().regex(/^fn_[a-z0-9_]{1,60}$/);
/** An outside host a function may call, e.g. "api.goshippo.com" (no wildcards except a leading "*."). */
export const Host = z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/).max(253);

/**
 * Server code the AI wrote for this business (docs/generated-code.md): runs in an isolated VM,
 * reaches only `hosts` (plus One App's own API), and gets the business's API keys injected by the
 * VM's firewall — the code never sees them.
 */
export const ServerFunction = z.strictObject({
  id: FunctionId,
  label: Label,
  source: z.string().min(1).max(MAX_COMPONENT_SOURCE),
  compiled: z.string().min(1).max(MAX_COMPONENT_COMPILED),
  hosts: z.array(Host).max(20),
  /** Can be called from outside at /api/hooks/<business>/<id> (e.g. a payment provider's webhook). */
  webhook: z.boolean().optional(),
});
export type ServerFunction = z.infer<typeof ServerFunction>;

/**
 * A document customers receive: a quote (scope of work they accept online) or an invoice (they
 * pay online). It maps onto ordinary tables — the document's own record, its lines, its
 * customer — so totals, statuses and history stay plain data (docs/documents.md).
 */
export const DocumentDef = z.strictObject({
  id: DocumentId,
  kind: z.enum(["quote", "invoice"]),
  /** "Quote", "Estimate", "Invoice". */
  label: Label,
  table: TableId,
  /** Text field that gets the next number ("Q-0007") when a record is created without one. */
  number: FieldId.optional(),
  prefix: z.string().max(10).optional(),
  /** Link to the customer (their name, email and phone are read from that record). */
  customer: FieldId,
  /** Short title, the scope of work / notes, and terms shown at the bottom. */
  title: FieldId.optional(),
  intro: FieldId.optional(),
  terms: FieldId.optional(),
  /** Fixed small print when there's no terms field. */
  footer: z.string().max(2000).optional(),
  /** Dates: issued (defaults to the created date), due (invoices) / valid until (quotes). */
  issued: FieldId.optional(),
  due: FieldId.optional(),
  /** Date field set when it's first sent to the customer (statuses derive from it). */
  sent: FieldId.optional(),
  lines: z.strictObject({
    table: TableId,
    /** The line's link to the document. */
    via: FieldId,
    description: FieldId,
    qty: FieldId.optional(),
    unit: FieldId.optional(),
    price: FieldId.optional(),
    total: FieldId,
    /** Optional grouping ("Labour", "Materials"). */
    group: FieldId.optional(),
  }),
  totals: z.strictObject({
    subtotal: FieldId.optional(),
    tax: FieldId.optional(),
    total: FieldId,
    paid: FieldId.optional(),
    balance: FieldId.optional(),
  }),
  /** Quotes: the customer accepts (or declines) online; these date/text fields record it. */
  accept: z
    .strictObject({
      acceptedOn: FieldId,
      acceptedBy: FieldId.optional(),
      declinedOn: FieldId.optional(),
    })
    .optional(),
  /** Invoices: the customer pays online; a paid payment is added as a record here. */
  pay: z
    .strictObject({
      table: TableId,
      via: FieldId,
      amount: FieldId,
      date: FieldId,
      title: FieldId.optional(),
      method: FieldId.optional(),
      /** Option id of the method field for card payments. */
      card: z.string().optional(),
    })
    .optional(),
  /** Invoices made from an accepted quote: the quote document, and this table's link to it. */
  from: z.strictObject({ document: DocumentId, link: FieldId }).optional(),
});
export type DocumentDef = z.infer<typeof DocumentDef>;

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
  functions: z.array(ServerFunction).max(100).optional(),
  theme: Theme.optional(),
  documents: z.array(DocumentDef).max(20).optional(),
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
      const at = ["tables", ti, "fields", fi];
      // The table whose records are rolled up, and the link that connects them.
      const source = f.from ? bp.tables.find((x) => x.id === f.from) : undefined;
      if (f.from && !source) return issue([...at, "from"], `unknown table ${f.from}`);
      const via = (source ?? t).fields.find((x) => x.id === f.via);
      if (!via || via.type !== "link" || (source && via.to !== t.id)) {
        return issue([...at, "via"], source ? `rollup must go via a link field on ${f.from} that points to ${t.id}` : `rollup must go via a link field on ${t.id}`);
      }
      const target = source ? source.id : via.to;
      const targetFields = fieldsOf(target);
      if (!targetFields.has(f.field)) issue([...at, "field"], `unknown field ${f.field} on ${target}`);
      for (const [wi, w] of (f.where ?? []).entries()) if (!targetFields.has(w.field)) issue([...at, "where", wi, "field"], `unknown field ${w.field} on ${target}`);
      if (f.sortBy && !targetFields.has(f.sortBy)) issue([...at, "sortBy"], `unknown field ${f.sortBy} on ${target}`);
    });
    t.fields.forEach((f, fi) => {
      if ((f.type !== "status" && f.type !== "choice") || !f.derive) return;
      const at = ["tables", ti, "fields", fi, "derive"];
      const opts = new Set(f.options.map((o) => o.id));
      if (f.multiple) issue(at, "a derived status picks one option");
      f.derive.rules.forEach((r, ri) => {
        if (!opts.has(r.option)) issue([...at, "rules", ri, "option"], `unknown option ${r.option}`);
        r.when.forEach((w, wi) => {
          if (!fieldIds.has(w.field)) issue([...at, "rules", ri, "when", wi, "field"], `unknown field ${w.field}`);
          if (w.field === f.id) issue([...at, "rules", ri, "when", wi, "field"], "a derived status can’t depend on itself");
        });
      });
      if (f.derive.otherwise && !opts.has(f.derive.otherwise)) issue([...at, "otherwise"], `unknown option ${f.derive.otherwise}`);
    });
    t.fields.forEach((f, fi) => {
      if (f.type !== "formula") return;
      const at = ["tables", ti, "fields", fi, "expression"];
      const node = compiledFormula(f.expression);
      if (node instanceof FormulaError) return issue(at, `formula: ${node.message}`);
      for (const id of formulaFields(node)) {
        const used = t.fields.find((x) => x.id === id);
        if (!used) issue(at, `unknown field ${id}`);
        else if (id === f.id) issue(at, "a formula can't use itself");
        else if ("derive" in used && used.derive) issue(at, `${id} is a status, not a number`);
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

  (bp.documents ?? []).forEach((d, di) => {
    claim(d.id, ["documents", di, "id"]);
    const at = ["documents", di];
    const own = fieldsOf(d.table);
    if (!tables.has(d.table)) return issue([...at, "table"], `unknown table ${d.table}`);
    const need = (path: (string | number)[], table: string, id: string | undefined) => id && !fieldsOf(table).has(id) && issue([...at, ...path], `unknown field ${id} on ${table}`);
    for (const k of ["number", "customer", "title", "intro", "terms", "issued", "due", "sent"] as const) need([k], d.table, d[k]);
    for (const [k, v] of Object.entries(d.totals)) need(["totals", k], d.table, v);
    for (const [k, v] of Object.entries(d.accept ?? {})) need(["accept", k], d.table, v);
    if (!tables.has(d.lines.table)) issue([...at, "lines", "table"], `unknown table ${d.lines.table}`);
    else for (const [k, v] of Object.entries(d.lines)) if (k !== "table") need(["lines", k], d.lines.table, v);
    const via = tables.get(d.lines.table)?.fields.find((f) => f.id === d.lines.via);
    if (via && (via.type !== "link" || via.to !== d.table)) issue([...at, "lines", "via"], `lines must link to ${d.table}`);
    if (d.pay) {
      if (!tables.has(d.pay.table)) issue([...at, "pay", "table"], `unknown table ${d.pay.table}`);
      else for (const [k, v] of Object.entries(d.pay)) if (k !== "table" && k !== "card") need(["pay", k], d.pay.table, v);
    }
    if (d.from) {
      if (!(bp.documents ?? []).some((x) => x.id === d.from!.document && x.kind === "quote")) issue([...at, "from", "document"], `unknown quote document ${d.from.document}`);
      if (!own.has(d.from.link)) issue([...at, "from", "link"], `unknown field ${d.from.link} on ${d.table}`);
    }
    if ((bp.documents ?? []).filter((x) => x.table === d.table).length > 1) issue([...at, "table"], `${d.table} already has a document`);
  });

  const recordPages = new Set<string>();
  bp.pages.forEach((p, pi) => {
    claim(p.id, ["pages", pi, "id"]);
    if (p.recordOf) {
      if (!tables.has(p.recordOf)) issue(["pages", pi, "recordOf"], `unknown table ${p.recordOf}`);
      if (recordPages.has(p.recordOf)) issue(["pages", pi, "recordOf"], `${p.recordOf} already has a record page`);
      recordPages.add(p.recordOf);
    }
    if (p.badge) checkSource(p.badge.source, ["pages", pi, "badge", "source"]);
    checkBlocks(p.layout.blocks, ["pages", pi, "layout", "blocks"], true);
    for (const [key, override] of Object.entries(p.layoutOverrides ?? {})) {
      // Override blocks may reuse ids from the default layout (same block, different position).
      if (override) checkBlocks(override.blocks, ["pages", pi, "layoutOverrides", key, "blocks"], false);
    }
  });

  (bp.functions ?? []).forEach((f, fi) => claim(f.id, ["functions", fi, "id"]));
  const functions = new Set((bp.functions ?? []).map((f) => f.id));
  bp.automations.forEach((a, ai) => {
    claim(a.id, ["automations", ai, "id"]);
    a.actions.forEach((act, xi) => {
      if (act.type === "run_function" && (typeof act.function !== "string" || !functions.has(act.function))) {
        issue(["automations", ai, "actions", xi, "function"], `unknown function ${String(act.function)}`);
      }
    });
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
