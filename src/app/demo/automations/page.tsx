import { AutomationsView } from "@/components/automations/AutomationsView";
import { currentDemo } from "@/demo/current";
import { samplesFrom } from "@/server/automationPage";
import type { RecordRow } from "@/schema/records";

export default async function DemoAutomations() {
  const { blueprint: demoBlueprint, records: all } = await currentDemo();
  const byTable = new Map<string, RecordRow[]>();
  for (const r of all) byTable.set(r.tableId, [...(byTable.get(r.tableId) ?? []), r]);
  return <AutomationsView mode={{ kind: "local" }} runs={[]} samples={samplesFrom(demoBlueprint, byTable, all)} />;
}
