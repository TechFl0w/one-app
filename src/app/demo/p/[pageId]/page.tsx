import { notFound } from "next/navigation";
import { getDevice } from "@/server/context";
import { PageView } from "@/components/page/PageView";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { memoryStore } from "@/engine/store";
import { submitDemoForm } from "../../actions";

export default async function DemoPage({ params }: PageProps<"/demo/p/[pageId]">) {
  const { pageId } = await params;
  const page = demoBlueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  return (
    <PageView
      page={page}
      device={await getDevice()}
      env={{
        blueprint: demoBlueprint,
        store: memoryStore(demoRecords()),
        formAction: (tableId, fields) => submitDemoForm.bind(null, tableId, fields),
      }}
    />
  );
}
