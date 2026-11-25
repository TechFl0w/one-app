import { getBusinessContext } from "@/server/context";
import { linkedTitleIds, listRuns, samplesFrom } from "@/server/automationPage";
import { supabaseStore } from "@/server/store";
import { listRecords } from "@/server/records";
import { AutomationsView } from "@/components/automations/AutomationsView";
import type { RecordRow } from "@/schema/records";

export default async function AutomationsPage({ params }: PageProps<"/b/[businessId]/automations">) {
  const { businessId } = await params;
  const { supabase, blueprint } = await getBusinessContext(businessId);
  const tables = [...new Set(blueprint.automations.map((a) => a.trigger.table).filter((t): t is string => !!t))];
  const byTable = new Map<string, RecordRow[]>();
  await Promise.all(
    tables.map(async (t) => {
      const { records } = await listRecords(supabase, businessId, { table: t, sort: [{ field: "_created_at", dir: "desc" }], limit: 20 }, blueprint);
      byTable.set(t, records);
    }),
  );
  const store = supabaseStore(supabase, businessId);
  const linked = (await Promise.all([...linkedTitleIds(blueprint, byTable)].map(([t, ids]) => store.getMany(t, ids)))).flat();
  const runs = await listRuns(supabase, businessId).catch(() => []);
  return <AutomationsView mode={{ kind: "server", businessId }} runs={runs} samples={samplesFrom(blueprint, byTable, linked)} />;
}
