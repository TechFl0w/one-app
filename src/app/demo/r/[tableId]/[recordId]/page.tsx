import { withComputed } from "@/engine/computed";
import { getDevice } from "@/server/context";
import { RecordPageView } from "@/components/page/RecordPageView";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { memoryStore } from "@/engine/store";
import { submitDemoForm } from "../../../actions";
import { demoSandboxCreate, demoSandboxGet, demoSandboxList, demoSandboxRemove, demoSandboxUpdate } from "../../../sandbox-actions";

export default async function DemoRecordPage({ params }: PageProps<"/demo/r/[tableId]/[recordId]">) {
  const { tableId, recordId } = await params;
  return (
    <RecordPageView
      tableId={tableId}
      recordId={recordId}
      device={await getDevice()}
      env={{
        blueprint: demoBlueprint,
        store: withComputed(memoryStore(demoRecords()), demoBlueprint),
        formAction: (t, fields) => submitDemoForm.bind(null, t, fields),
        sandbox: { basePath: "/demo", bridge: { list: demoSandboxList, get: demoSandboxGet, create: demoSandboxCreate, update: demoSandboxUpdate, remove: demoSandboxRemove } },
      }}
    />
  );
}
