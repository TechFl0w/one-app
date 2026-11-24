import { notFound } from "next/navigation";
import { getBusinessContext, getDevice } from "@/server/context";
import { PageView } from "@/components/page/PageView";

export default async function BusinessPage({ params }: PageProps<"/b/[businessId]/p/[pageId]">) {
  const { businessId, pageId } = await params;
  const [{ blueprint, userId }, device] = await Promise.all([getBusinessContext(businessId), getDevice()]);
  const page = blueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  return <PageView blueprint={blueprint} page={page} device={device} userId={userId} />;
}
