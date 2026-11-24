import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditRow } from "@/engine/auditText";

/** Latest audit entries (RLS: owners and admins only; others get an empty list). */
export async function listAudit(supabase: SupabaseClient, businessId: string, limit = 100): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, source, action, table_id, record_id, summary, details, created_at")
    .eq("business_id", businessId)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return (data ?? []) as AuditRow[];
}
