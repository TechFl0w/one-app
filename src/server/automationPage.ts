import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { recordLabel } from "@/engine/blockData";
import { formatDateTime } from "@/components/blocks/format";
import type { RunRow, Samples } from "@/components/automations/AutomationsView";

/** Recent runs (RLS: owners/admins). */
export async function listRuns(supabase: SupabaseClient, businessId: string): Promise<RunRow[]> {
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id, automation_id, status, test, steps, error, at")
    .eq("business_id", businessId)
    .order("at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load runs: ${error.message}`);
  return (data ?? []) as RunRow[];
}

/** Linked records needed to name samples whose title field is a link (e.g. a booking's client). */
export function linkedTitleIds(bp: Blueprint, byTable: Map<string, RecordRow[]>): Map<string, string[]> {
  const need = new Map<string, Set<string>>();
  for (const [tableId, rows] of byTable) {
    const table = bp.tables.find((t) => t.id === tableId);
    const title = table?.fields.find((f) => f.id === table.primaryField);
    if (title?.type !== "link") continue;
    const set = need.get(title.to) ?? new Set<string>();
    rows.forEach((r) => typeof r.data[title.id] === "string" && set.add(r.data[title.id] as string));
    need.set(title.to, set);
  }
  return new Map([...need].map(([t, ids]) => [t, [...ids]]));
}

/** A few recent records per trigger table, for test mode, named like "Ava Thompson · Mon, Nov 23, 9:00 a.m.". */
export function samplesFrom(bp: Blueprint, byTable: Map<string, RecordRow[]>, linked: RecordRow[] = []): Samples {
  const labels: Record<string, string> = {};
  for (const r of linked) {
    const t = bp.tables.find((x) => x.id === r.tableId);
    if (t) labels[r.id] = recordLabel(t, r);
  }
  const out: Samples = {};
  for (const [tableId, rows] of byTable) {
    const table = bp.tables.find((t) => t.id === tableId);
    if (!table) continue;
    const when = table.fields.find((f) => f.type === "datetime" || f.type === "date");
    out[tableId] = rows.map((r) => {
      const v = when && r.data[when.id];
      const date = typeof v === "string" ? formatDateTime(v.length === 10 ? `${v}T12:00:00Z` : v, { timezone: bp.business.timezone }, when!.type === "date" ? "date" : "full") : "";
      return { id: r.id, data: r.data, label: [recordLabel(table, r, labels), date].filter(Boolean).join(" · ") };
    });
  }
  return out;
}
