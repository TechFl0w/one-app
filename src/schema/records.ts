import { z } from "zod";
import { FieldId, TableId } from "./blueprint";

/** Record input/query shapes. Field values are checked per field type in src/engine/records.ts. */

export const RecordId = z.uuid();

/** Values keyed by field id. `null` clears a field. */
export const RecordInput = z.record(FieldId, z.unknown());
export type RecordInput = z.infer<typeof RecordInput>;

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"] as const;
export const FilterOp = z.enum(FILTER_OPS);
export type FilterOp = z.infer<typeof FilterOp>;

export const RecordFilter = z.strictObject({
  field: FieldId,
  op: FilterOp,
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type RecordFilter = z.infer<typeof RecordFilter>;

export const RecordSort = z.strictObject({
  field: z.union([FieldId, z.enum(["_created_at", "_updated_at"])]),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const RecordQuery = z.strictObject({
  table: TableId,
  filters: z.array(RecordFilter).max(20).default([]),
  sort: z.array(RecordSort).max(5).default([]),
  limit: z.int().min(1).max(500).default(50),
  offset: z.int().min(0).default(0),
});
export type RecordQuery = z.input<typeof RecordQuery>;

export interface RecordRow {
  id: string;
  tableId: string;
  /** Only fields that exist in the current blueprint. */
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const FileValue = z.strictObject({
  path: z.string().min(1).max(500),
  name: z.string().min(1).max(255),
  size: z.int().min(0).optional(),
  mime: z.string().max(100).optional(),
});
