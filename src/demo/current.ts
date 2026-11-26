import "server-only";
import { cookies } from "next/headers";
import type { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { templateById } from "@/templates";
import { resolveSeed } from "@/templates/types";
import { demoBlueprint, demoRecords } from "./salon";

/**
 * Which demo the visitor is looking at: the nail salon (default) or a business type's template
 * with its sample data (/demo?type=mechanic — remembered in a cookie). Nothing is ever saved.
 */
export const DEMO_COOKIE = "demo_type";
export const DEMO_TYPES = ["salon", "mechanic"] as const;

const built = new Map<string, Blueprint>();
/** What the sample business is called in each demo. */
const DEMO_NAMES: Record<string, string> = { mechanic: "Northside Auto Repair" };

function fromTemplate(id: string): { blueprint: Blueprint; records: RecordRow[] } | null {
  const template = templateById(id);
  if (!template) return null;
  const { blueprint, seed } = template.build({ name: DEMO_NAMES[id] ?? template.label, timezone: "America/Vancouver" }, {});
  if (!built.has(id)) built.set(id, blueprint);
  // Stable ids, so a record page link keeps working while the demo is browsed.
  const ids = new Map<string, string>();
  const at = "2026-01-01T00:00:00.000Z";
  const records = seed.map((s, i): RecordRow => {
    const recordId = `00000000-0000-4000-8000-${String(500000 + i).padStart(12, "0")}`;
    const data = resolveSeed(s.data, ids);
    if (s.ref) ids.set(s.ref, recordId);
    return { id: recordId, tableId: s.table, data, createdAt: at, updatedAt: at };
  });
  return { blueprint: built.get(id)!, records };
}

export async function currentDemo(): Promise<{ type: string; blueprint: Blueprint; records: RecordRow[] }> {
  const type = (await cookies()).get(DEMO_COOKIE)?.value;
  const t = type && type !== "salon" ? fromTemplate(type) : null;
  return t ? { type: type!, ...t } : { type: "salon", blueprint: demoBlueprint, records: demoRecords() };
}
