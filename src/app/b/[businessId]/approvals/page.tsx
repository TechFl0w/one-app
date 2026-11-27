import { ShieldCheck } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { Approvals, type ApprovalRow } from "@/components/mcp/Approvals";
import { resolveApproval } from "../mcp-actions";
import { staleReason } from "@/agent/stale";
import { resolvePending } from "@/server/ownerChat";

export default async function ApprovalsPage({ params }: PageProps<"/b/[businessId]/approvals">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const { data } = await supabase
    .from("agent_pending_actions")
    .select("id, tool, input, items, created_at")
    .eq("business_id", businessId)
    .eq("origin", "mcp")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  // Re-checked on every visit: requests for things that have since gone are cleared, not shown.
  const rows = (data ?? []) as (ApprovalRow & { tool: string; input: unknown })[];
  const stale = rows.filter((r) => staleReason(blueprint, r.tool, r.input));
  if (stale.length) await resolvePending(supabase, stale.map((r) => r.id), "cancelled").catch(() => undefined);
  const live = rows.filter((r) => !stale.includes(r));
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
      </div>
      <p className="mb-6 text-sm text-muted">Changes that delete things, move money, message people or change automatic steps wait here until you say yes.</p>
      {stale.length > 0 && (
        <p className="mb-4 rounded-xl bg-ground px-4 py-3 text-sm text-muted">
          Cleared {stale.length} earlier {stale.length === 1 ? "request" : "requests"} that no longer apply — the {stale.length === 1 ? "thing it was" : "things they were"} for {stale.length === 1 ? "has" : "have"} changed or been removed.
        </p>
      )}
      <Approvals rows={live} resolve={resolveApproval.bind(null, businessId)} />
    </div>
  );
}
