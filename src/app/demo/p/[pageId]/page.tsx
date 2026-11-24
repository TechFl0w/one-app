import { notFound } from "next/navigation";
import { getDevice } from "@/server/context";
import { PageView } from "@/components/page/PageView";
import { demoBlueprint } from "@/demo/salon";

export default async function DemoPage({ params }: PageProps<"/demo/p/[pageId]">) {
  const { pageId } = await params;
  const page = demoBlueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  return <PageView blueprint={demoBlueprint} page={page} device={await getDevice()} />;
}
