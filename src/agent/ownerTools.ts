import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { FieldId, TableId, type Blueprint } from "@/schema/blueprint";
import { Operation } from "@/schema/changeSet";
import { RecordFilter, RecordId } from "@/schema/records";
import { previewChangeSet, type OpPreview } from "@/engine/changeSet";
import { recordLabel } from "@/engine/blockData";
import type { UndoToken } from "@/engine/commit";
import type { OwnerBackend } from "./types";
import { recordUpdateIsRisky } from "@/engine/risk";

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
