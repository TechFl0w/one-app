import "server-only";
import type { AuditRow } from "@/engine/auditText";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecordStore } from "@/engine/store";
import type { RecordRow } from "@/schema/records";

type Row = { id: string; data: Record<string, unknown>; created_at: string; updated_at: string };
const view = (tableId: string, r: Row): RecordRow => ({
  id: r.id,
  tableId,
  data: r.data ?? {},
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** RecordStore backed by Supabase, acting as the signed-in user (RLS applies). */
export function supabaseStore(supabase: SupabaseClient, businessId: string): RecordStore {
  return {
    async query(p) {
      const { data, error } = await supabase.rpc("query_records", { p_business_id: businessId, ...p });
      if (error) throw new Error(`Could not load records: ${error.message}`);
      const rows = (data ?? []) as (Row & { total: number })[];
      return { records: rows.map((r) => view(p.p_table_id, r)), total: rows.length ? Number(rows[0].total) : 0 };
    },
    async aggregate(p) {
      const { data, error } = await supabase.rpc("aggregate_records", { p_business_id: businessId, ...p });
      if (error) throw new Error(`Could not compute ${p.p_agg}: ${error.message}`);
      return data === null ? null : Number(data);
    },
    async getMany(tableId, ids) {
      if (!ids.length) return [];
      const { data, error } = await supabase
        .from("records")
        .select("id, data, created_at, updated_at")
        .eq("business_id", businessId)
        .eq("table_id", tableId)
        .in("id", ids);
      if (error) throw new Error(`Could not load linked records: ${error.message}`);
      return ((data ?? []) as Row[]).map((r) => view(tableId, r));
    },
    async history(recordIds, limit) {
      if (!recordIds.length) return [];
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, actor_id, source, action, table_id, record_id, summary, details, created_at")
        .eq("business_id", businessId)
        .in("record_id", recordIds.slice(0, 200))
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Could not load activity: ${error.message}`);
      return (data ?? []) as AuditRow[];
    },
  };
}
