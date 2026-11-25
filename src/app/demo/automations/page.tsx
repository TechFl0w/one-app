import { AutomationsView } from "@/components/automations/AutomationsView";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { samplesFrom } from "@/server/automationPage";
import type { RecordRow } from "@/schema/records";

export default function DemoAutomations() {
  const all = demoRecords();
  const byTable = new Map<string, RecordRow[]>();
  for (const r of all) byTable.set(r.tableId, [...(byTable.get(r.tableId) ?? []), r]);
  return <AutomationsView mode={{ kind: "local" }} runs={[]} samples={samplesFrom(demoBlueprint, byTable, all)} />;
}
