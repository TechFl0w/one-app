import { Code2 } from "lucide-react";
import { getBusinessContext } from "@/server/context";
import { functionsAvailable } from "@/server/functions";
import { CodeSettings, type KeyRow, type RunRow } from "@/components/code/CodeSettings";
import { removeApiKey, saveApiKey } from "../../code-actions";

export default async function CodeSettingsPage({ params }: PageProps<"/b/[businessId]/settings/code">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const [{ data: keys }, { data: runs }] = await Promise.all([
    supabase.rpc("business_secret_names", { bid: businessId }),
    supabase.from("function_runs").select("id, function_id, trigger, status, error, logs, started_at").eq("business_id", businessId).order("started_at", { ascending: false }).limit(20),
  ]);
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <Code2 className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">API keys & server code</h1>
      </div>
      <CodeSettings
        available={functionsAvailable()}
        keys={(keys ?? []) as KeyRow[]}
        functions={(blueprint.functions ?? []).map((f) => ({ id: f.id, label: f.label, hosts: f.hosts, webhookUrl: f.webhook ? `${app}/api/hooks/${businessId}/${f.id}` : null }))}
        runs={(runs ?? []) as RunRow[]}
        save={saveApiKey.bind(null, businessId)}
        remove={removeApiKey.bind(null, businessId)}
      />
    </div>
  );
}
