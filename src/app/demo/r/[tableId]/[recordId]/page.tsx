import { withComputed } from "@/engine/computed";
import { getDevice } from "@/server/context";
import { RecordPageView } from "@/components/page/RecordPageView";
import { currentDemo } from "@/demo/current";
import { memoryStore } from "@/engine/store";
import { submitDemoForm } from "../../../actions";
import { demoSandboxCreate, demoSandboxGet, demoSandboxList, demoSandboxRemove, demoSandboxUpdate, demoFreeTimes, demoBookTime } from "../../../sandbox-actions";

export default async function DemoRecordPage({ params }: PageProps<"/demo/r/[tableId]/[recordId]">) {
  const { tableId, recordId } = await params;
  const demo = await currentDemo();
  return (
    <RecordPageView
      tableId={tableId}
      recordId={recordId}
      device={await getDevice()}
      env={{
        blueprint: demo.blueprint,
        store: withComputed(memoryStore(demo.records), demo.blueprint),
        formAction: (t, fields) => submitDemoForm.bind(null, t, fields),
        sandbox: { basePath: "/demo", bridge: { list: demoSandboxList, get: demoSandboxGet, create: demoSandboxCreate, update: demoSandboxUpdate, remove: demoSandboxRemove, freeTimes: demoFreeTimes, bookTime: demoBookTime } },
      }}
    />
  );
}
