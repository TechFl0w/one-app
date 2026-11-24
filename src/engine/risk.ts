import type { Table } from "@/schema/blueprint";

/**
 * One place for "what needs the owner's explicit confirmation" (CLAUDE.md rule 5):
 * deleting data, refunds, price changes, bulk messages, automation changes.
 * Setup changes carry their own risk per operation (OP_RISK in schema/changeSet.ts).
 */

/** Changing an existing record's money fields (prices, amounts) is a price change. */
export function recordUpdateIsRisky(table: Table, patch: Record<string, unknown>): boolean {
  const money = new Set(table.fields.filter((f) => f.type === "money").map((f) => f.id));
  return Object.keys(patch).some((k) => money.has(k));
}

export const RECORD_DELETE_IS_RISKY = true;
