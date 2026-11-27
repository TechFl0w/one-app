import { withComputed } from "@/engine/computed";
import { getDevice } from "@/server/context";
import { PageView } from "@/components/page/PageView";
import { EditablePage } from "@/components/page/EditablePage";
import { currentDemo } from "@/demo/current";
import { memoryStore } from "@/engine/store";
import { submitDemoForm } from "../../actions";
import { demoSandboxCreate, demoSandboxGet, demoSandboxList, demoSandboxRemove, demoSandboxUpdate, demoFreeTimes, demoBookTime } from "../../sandbox-actions";

export default async function DemoPage({ params }: PageProps<"/demo/p/[pageId]">) {
  const { pageId } = await params;
  const demo = await currentDemo();
  const page = demo.blueprint.pages.find((p) => p.id === pageId);
  if (!page) return <EditablePage pageId={pageId} device={await getDevice()} rendered={{}} />;
  return (
    <PageView
      page={page}
      device={await getDevice()}
      env={{
        blueprint: demo.blueprint,
        store: withComputed(memoryStore(demo.records), demo.blueprint),
        formAction: (tableId, fields) => submitDemoForm.bind(null, tableId, fields),
        sandbox: { basePath: "/demo", bridge: { list: demoSandboxList, get: demoSandboxGet, create: demoSandboxCreate, update: demoSandboxUpdate, remove: demoSandboxRemove, freeTimes: demoFreeTimes, bookTime: demoBookTime } },
      }}
    />
  );
}
