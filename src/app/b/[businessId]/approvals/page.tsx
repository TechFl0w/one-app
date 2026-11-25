import { ShieldCheck } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { Approvals, type ApprovalRow } from "@/components/mcp/Approvals";
import { resolveApproval } from "../mcp-actions";

export default async function ApprovalsPage({ params }: PageProps<"/b/[businessId]/approvals">) {
  const { businessId } = await params;
  const { supabase } = await getBusinessContext(businessId);
  const { data } = await supabase
    .from("agent_pending_actions")
    .select("id, items, created_at")
    .eq("business_id", businessId)
    .eq("origin", "mcp")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
      </div>
      <p className="mb-6 text-sm text-muted">Risky changes asked for by connected AI apps wait here until you approve them.</p>
      <Approvals rows={(data ?? []) as ApprovalRow[]} resolve={resolveApproval.bind(null, businessId)} />
    </div>
  );
}
