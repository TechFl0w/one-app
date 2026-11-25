import { Plug } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { mcpUrl } from "@/server/mcp";
import { Connections, type TokenRow } from "@/components/mcp/Connections";
import { createTokenAction, revokeTokenAction } from "../../mcp-actions";

export default async function ConnectionsPage({ params }: PageProps<"/b/[businessId]/settings/connections">) {
  const { businessId } = await params;
  const { supabase } = await getBusinessContext(businessId);
  const { data } = await supabase
    .from("api_tokens")
    .select("id, name, hint, created_at, last_used_at")
    .eq("business_id", businessId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Plug className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">Connect AI apps</h1>
      </div>
      <Connections url={mcpUrl()} tokens={(data ?? []) as TokenRow[]} create={createTokenAction.bind(null, businessId)} revoke={revokeTokenAction.bind(null, businessId)} />
    </div>
  );
}
