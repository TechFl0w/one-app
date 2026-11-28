import type { Blueprint } from "@/schema/blueprint";
import { previewChangeSet } from "@/engine/changeSet";

/**
 * Whether a waiting approval still makes sense against today's setup. A request to change a
 * table that has since been removed, or a setup change that no longer applies, is stale: it's
 * cleared rather than shown as something to approve. Returns a plain reason, or null if fine.
 */
export function staleReason(bp: Blueprint, tool: string, input: unknown): string | null {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (tool === "change_setup" && Array.isArray(i.ops)) {
    const p = previewChangeSet(bp, { baseVersion: bp.version, source: "ai", ops: i.ops }, { confirmed: true });
    return p.ok ? null : p.error.message;
  }
  for (const key of ["table", "tableId"]) {
    const t = i[key];
    if (typeof t === "string" && t.startsWith("tbl_") && !bp.tables.some((x) => x.id === t)) return `the table it was for has been removed`;
  }
  return null;
}
