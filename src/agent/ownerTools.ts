import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { FieldId, TableId, type Blueprint } from "@/schema/blueprint";
import { Operation } from "@/schema/changeSet";
import { RecordFilter, RecordId } from "@/schema/records";
import { previewChangeSet, type OpPreview } from "@/engine/changeSet";
import { recordLabel } from "@/engine/blockData";
import type { UndoToken } from "@/engine/commit";
import type { OwnerBackend, PendingAction } from "./types";
import { recordUpdateIsRisky } from "@/engine/risk";
import { availableSlots, bookSlot } from "@/booking/service";
import { compileComponent } from "@/codegen/compile";
import { ComponentId, GRID_COLUMNS, Label, PageId } from "@/schema/blueprint";
import type { Operation as Op } from "@/schema/changeSet";

/**
 * The owner agent's tools. Each has a zod schema (inputs are validated before running), a risk
 * level, and a run function over OwnerBackend. Risky tools never run inside the model loop: the
 * loop parks them as PendingActions and code runs them after the owner confirms.
 */

export type Risk = "read" | "safe" | "risky";

export interface ToolEffects {
  changed?: boolean;
  preview?: { summary: string; ops: OpPreview[]; undo: UndoToken };
}

export interface OwnerTool<I = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  /** Fixed risk, or decided from the input (e.g. price changes). */
  risk: Risk | ((input: I, bp: Blueprint) => Risk);
  /** Plain-language lines for a confirmation, for risky calls. */
  describe?: (input: I, bp: Blueprint) => string[];
  run: (backend: OwnerBackend, input: I, effects: ToolEffects, opts: { confirmed: boolean }) => Promise<unknown>;
}

const tool = <I>(t: OwnerTool<I>) => t as unknown as OwnerTool<unknown>;

const Values = z.record(FieldId, z.unknown()).describe("Field values keyed by field id (fld_…). Use null to clear a field.");

const tableLabel = (bp: Blueprint, id: string) => bp.tables.find((t) => t.id === id)?.label ?? id;

export const OWNER_TOOLS: OwnerTool[] = [
  tool({
    name: "query_records",
    description:
      "List records of one table, with optional filters and sorting. Dates accept tokens like @today, @tomorrow, @this_week, @now. Returns at most `limit` rows plus the total count.",
    input: z.strictObject({
      table: TableId,
      filters: z.array(RecordFilter).max(20).optional(),
      sort: z.array(z.strictObject({ field: z.union([FieldId, z.enum(["_created_at", "_updated_at"])]), dir: z.enum(["asc", "desc"]) })).max(5).optional(),
      limit: z.int().min(1).max(100).optional(),
    }),
    risk: "read",
    run: async (b, i) => {
      const { records, total } = await b.query({ table: i.table, filters: i.filters ?? [], sort: i.sort ?? [], limit: i.limit ?? 25 });
      return { total, records: records.map((r) => ({ id: r.id, ...r.data })) };
    },
  }),

  tool({
    name: "get_record",
    description: "Get one record by id.",
    input: z.strictObject({ table: TableId, id: RecordId }),
    risk: "read",
    run: async (b, i) => {
      const r = await b.getRecord(i.table, i.id);
      return { id: r.id, ...r.data, _created_at: r.createdAt, _updated_at: r.updatedAt };
    },
  }),

  tool({
    name: "create_record",
    description: "Create a record in a table. Values are validated against the table's fields.",
    input: z.strictObject({ table: TableId, values: Values }),
    risk: "safe",
    run: async (b, i, fx) => {
      const r = await b.createRecord(i.table, i.values);
      fx.changed = true;
      return { created: { id: r.id, ...r.data } };
    },
  }),

  tool({
    name: "update_record",
    description: "Change some fields of a record (others stay as they are). Changing money fields (prices, amounts) needs the owner's confirmation.",
    input: z.strictObject({ table: TableId, id: RecordId, values: Values }),
    risk: (i, bp) => {
      const table = bp.tables.find((t) => t.id === i.table);
      return table && recordUpdateIsRisky(table, i.values) ? "risky" : "safe";
    },
    describe: (i, bp) => {
      const table = bp.tables.find((t) => t.id === i.table);
      const fields = Object.keys(i.values).map((k) => table?.fields.find((f) => f.id === k)?.label ?? k);
      return [`Change ${fields.join(", ")} on a ${tableLabel(bp, i.table).toLowerCase()} record to ${JSON.stringify(i.values)}`];
    },
    run: async (b, i, fx, { confirmed }) => {
      const r = await b.updateRecord(i.table, i.id, i.values, { confirmed });
      fx.changed = true;
      return { updated: { id: r.id, ...r.data } };
    },
  }),

  tool({
    name: "delete_record",
    description: "Delete a record. Always needs the owner's confirmation.",
    input: z.strictObject({ table: TableId, id: RecordId }),
    risk: "risky",
    describe: (i, bp) => [`Delete a record from ${tableLabel(bp, i.table)} (${i.id.slice(0, 8)})`],
    run: async (b, i, fx) => {
      await b.deleteRecord(i.table, i.id);
      fx.changed = true;
      return { deleted: i.id };
    },
  }),

  tool({
    name: "change_setup",
    description:
      "Change the business setup (blueprint): rename things, add/remove tables, fields, pages and blocks, move/resize blocks, add or change automations. " +
      "Give all operations for one request together. Reference existing things by id; for new things invent ids like tbl_orders, fld_due_date, pg_orders, blk_orders_table. " +
      "Safe changes apply immediately and the owner can undo them; removing data or changing automations waits for the owner's confirmation.",
    input: z.strictObject({
      summary: z.string().min(1).max(300).describe("One short sentence describing the change for the owner."),
      ops: z.array(Operation).min(1).max(100),
    }),
    risk: (i, bp) => {
      const p = previewChangeSet(bp, { baseVersion: bp.version, source: "ai", ops: i.ops });
      return p.ok && p.requiresConfirmation ? "risky" : "safe";
    },
    describe: (i, bp) => {
      const p = previewChangeSet(bp, { baseVersion: bp.version, source: "ai", ops: i.ops });
      return p.ok ? p.ops.map((o) => o.description) : [i.summary];
    },
    run: async (b, i, fx, { confirmed }) => {
      const bp = await b.blueprint();
      const r = await b.commitChangeSet({ baseVersion: bp.version, source: "ai", summary: i.summary, ops: i.ops }, confirmed);
      if (!r.ok) throw new Error(r.error);
      const p = previewChangeSet(bp, { baseVersion: bp.version, source: "ai", ops: i.ops });
      fx.changed = true;
      fx.preview = { summary: i.summary, ops: p.ok ? p.ops : [], undo: r.undo };
      return { applied: r.summary, version: r.blueprint.version };
    },
  }),

  tool({
    name: "write_component",
    description:
      "Write (or rewrite) a custom UI component in TSX and show it in the app — for anything the standard blocks can't do: collapsible sections, custom layouts, " +
      "bespoke cards, dashboards, multi-step flows, whole custom pages. The code is type-checked; if there are errors you get them back and must fix and call again. " +
      "Placement: `page` adds it as a block on an existing page (x/y/w/h on the 12-column grid), `newPage` creates a page that is just this component (full width, sized to content), " +
      "`replaceBlocks` removes those blocks from `page` first (e.g. to swap a standard form + board for one custom component). Omit placement when only updating an existing component's code.",
    input: z.strictObject({
      id: ComponentId.describe("cmp_… id; reuse an existing id to update that component"),
      label: Label.describe("Short owner-facing name, e.g. 'Bookings hub'"),
      source: z.string().min(1).max(60_000).describe("Complete TSX module; default export is the component. Import only from 'react' and '@one/kit'."),
      summary: z.string().min(1).max(300).describe("One short sentence for the owner describing the change."),
      page: PageId.optional(),
      replaceBlocks: z.array(z.string()).max(20).optional(),
      position: z.strictObject({ x: z.int().min(0).max(GRID_COLUMNS - 1), y: z.int().min(0), w: z.int().min(1).max(GRID_COLUMNS), h: z.int().min(1).max(50) }).optional(),
      newPage: z.strictObject({ id: PageId, label: Label, icon: z.string().max(40).optional() }).optional(),
      props: z.record(z.string(), z.unknown()).optional().describe("Values the component reads with useProps()"),
    }),
    risk: "safe",
    run: async (b, i, fx) => {
      const compiled = compileComponent(i.source);
      if (!compiled.ok) throw new Error(`The component didn't compile — fix these and call write_component again:\n${compiled.errors.join("\n")}`);
      const bp = await b.blueprint();
      const ops: Op[] = [{ op: "putComponent", component: { id: i.id, label: i.label, source: i.source, compiled: compiled.compiled } }];
      const blockId = `blk_${i.id.slice(4)}`.slice(0, 64);
      const block = (x: number, y: number, w: number, h: number) => ({ id: blockId, type: "custom" as const, x, y, w, h, options: { component: i.id, ...(i.props ? { props: i.props } : {}) } });
      if (i.newPage) {
        const order = Math.max(-1, ...bp.pages.map((p) => p.menuOrder)) + 1;
        ops.push({ op: "addPage", page: { id: i.newPage.id, label: i.newPage.label, ...(i.newPage.icon ? { icon: i.newPage.icon } : {}), menuOrder: order, hidden: false, layout: { columns: GRID_COLUMNS, blocks: [block(0, 0, GRID_COLUMNS, 8)] } } });
      } else if (i.page) {
        const page = bp.pages.find((p) => p.id === i.page);
        if (!page) throw new Error(`Unknown page ${i.page}`);
        for (const id of i.replaceBlocks ?? []) ops.push({ op: "removeBlock", pageId: page.id, blockId: id });
        const exists = page.layout.blocks.some((x) => x.id === blockId) && !(i.replaceBlocks ?? []).includes(blockId);
        const pos = i.position ?? { x: 0, y: 0, w: GRID_COLUMNS, h: 6 };
        if (exists) ops.push({ op: "updateBlock", pageId: page.id, block: block(pos.x, pos.y, pos.w, pos.h) });
        else ops.push({ op: "addBlock", pageId: page.id, block: block(pos.x, pos.y, pos.w, pos.h) });
      }
      const r = await b.commitChangeSet({ baseVersion: bp.version, source: "ai", summary: i.summary, ops }, false);
      if (!r.ok) throw new Error(r.error);
      const p = previewChangeSet(bp, { baseVersion: bp.version, source: "ai", ops });
      fx.changed = true;
      fx.preview = { summary: i.summary, ops: p.ok ? p.ops : [], undo: r.undo };
      return { applied: i.summary, component: i.id, ...(i.newPage ? { page: i.newPage.id } : i.page ? { page: i.page, block: blockId } : {}) };
    },
  }),

  tool({
    name: "read_component",
    description: "The current TSX source of a custom component (read it before changing it).",
    input: z.strictObject({ id: ComponentId }),
    risk: "read",
    run: async (b, i) => {
      const c = (await b.blueprint()).components?.find((x) => x.id === i.id);
      if (!c) throw new Error(`No component ${i.id}`);
      return { id: c.id, label: c.label, source: c.source };
    },
  }),

  tool({
    name: "find_free_times",
    description: "Free appointment times for a service (optionally with one practitioner), from a date (YYYY-MM-DD, business timezone) for up to 7 days. Needs online booking set up.",
    input: z.strictObject({
      service: RecordId,
      practitioner: RecordId.optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      days: z.int().min(1).max(7).optional(),
    }),
    risk: "read",
    run: async (b, i) => {
      const bp = await b.blueprint();
      const [y, m, d] = i.date.split("-").map(Number);
      const slots = await availableSlots(bp, b, { serviceId: i.service, practitionerId: i.practitioner, from: { year: y, month: m, day: d }, days: i.days ?? 1 });
      return { timezone: bp.business.timezone, count: slots.length, slots: slots.slice(0, 40) };
    },
  }),

  tool({
    name: "book_appointment",
    description: "Book an appointment at a free time (use find_free_times first). Finds the client by email/phone or adds them. Starts as a request unless the business auto-confirms.",
    input: z.strictObject({
      service: RecordId,
      start: z.string().describe("Exact slot start (ISO) from find_free_times"),
      practitioner: RecordId.optional(),
      client: z.strictObject({ name: z.string().min(1).max(100), email: z.string().optional(), phone: z.string().optional() }),
    }),
    risk: "safe",
    run: async (b, i, fx) => {
      const bp = await b.blueprint();
      const r = await bookSlot(bp, b, { serviceId: i.service, practitionerId: i.practitioner, start: i.start, client: i.client });
      fx.changed = true;
      return { booked: r };
    },
  }),

  tool({
    name: "create_payment_link",
    description: "Create a Stripe payment page for an amount (optionally tied to a record, e.g. a booking or order) and return its link to share with the customer. Use interval for recurring charges like weekly rent.",
    input: z.strictObject({
      amount: z.number().positive().max(100_000),
      currency: z.string().regex(/^[A-Za-z]{3}$/).optional(),
      description: z.string().min(1).max(200),
      interval: z.enum(["week", "month"]).optional(),
      table: TableId.optional(),
      record: RecordId.optional(),
      email: z.string().email().optional(),
    }),
    risk: "safe",
    run: async (b, i) => {
      if (!b.payments) throw new Error("Payments aren’t connected yet. The owner can connect Stripe in Settings → Payments.");
      const link = await b.payments.createLink({
        kind: i.interval ? "subscription" : "payment",
        amount: i.amount,
        currency: (i.currency ?? process.env.DEFAULT_CURRENCY ?? "CAD").toUpperCase(),
        description: i.description,
        interval: i.interval,
        tableId: i.table,
        recordId: i.record,
        email: i.email,
      });
      return { link: link.url };
    },
  }),

  tool({
    name: "list_payments",
    description: "Recent payments (deposits, payment links, subscriptions) with status.",
    input: z.strictObject({ limit: z.int().min(1).max(50).optional() }),
    risk: "read",
    run: async (b, i) => {
      if (!b.payments) throw new Error("Payments aren’t connected yet.");
      return { payments: await b.payments.list(i.limit ?? 20) };
    },
  }),

  tool({
    name: "refund_payment",
    description: "Refund a paid payment in full. Always needs the owner's confirmation.",
    input: z.strictObject({ payment_id: z.uuid(), reason: z.string().max(200).optional() }),
    risk: "risky",
    describe: (i) => [`Refund payment ${i.payment_id.slice(0, 8)} in full${i.reason ? ` (${i.reason})` : ""}`],
    run: async (b, i, fx) => {
      if (!b.payments) throw new Error("Payments aren’t connected yet.");
      await b.payments.refund(i.payment_id);
      fx.changed = true;
      return { refunded: i.payment_id };
    },
  }),

  tool({
    name: "explain_automation",
    description: "Explain what an automation does, in plain words, with its trigger, conditions and actions.",
    input: z.strictObject({ id: z.string().regex(/^aut_[a-z0-9_]{1,60}$/) }),
    risk: "read",
    run: async (b, i) => {
      const bp = await b.blueprint();
      const a = bp.automations.find((x) => x.id === i.id);
      if (!a) throw new Error(`Automation ${i.id} not found`);
      return a;
    },
  }),
];

const byName = new Map(OWNER_TOOLS.map((t) => [t.name, t]));
export const ownerTool = (name: string) => byName.get(name);

/** Tool definitions for the Messages API (JSON Schema generated from the zod schemas). */
export function ownerToolDefinitions(): Anthropic.Beta.BetaTool[] {
  return OWNER_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.BetaTool["input_schema"] };
  });
}

/** Display label for a record in tool results / confirmations. */
export function labelFor(bp: Blueprint, tableId: string, record: Parameters<typeof recordLabel>[1]) {
  const t = bp.tables.find((x) => x.id === tableId);
  return t ? recordLabel(t, record) : record.id;
}

export type ToolOutcome = { kind: "result"; value: unknown } | { kind: "error"; message: string } | { kind: "pending"; action: PendingAction };

/**
 * Validates and runs one owner tool call. Risky calls don't run: they come back as a
 * PendingAction for code to run after the owner confirms. Shared by the in-app agent and the
 * business's MCP server, so both have exactly the same tools and rules.
 */
export async function executeOwnerTool(name: string, rawInput: unknown, backend: OwnerBackend, effects: ToolEffects, newId: () => string): Promise<ToolOutcome> {
  const t = ownerTool(name);
  if (!t) return { kind: "error", message: `Unknown tool ${name}` };
  const parsed = t.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { kind: "error", message: `Invalid input: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  try {
    const bp = await backend.blueprint();
    const risk = typeof t.risk === "function" ? t.risk(parsed.data, bp) : t.risk;
    if (risk === "risky") return { kind: "pending", action: { id: newId(), tool: t.name, input: parsed.data, items: t.describe?.(parsed.data, bp) ?? [name] } };
    return { kind: "result", value: await t.run(backend, parsed.data, effects, { confirmed: false }) };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
