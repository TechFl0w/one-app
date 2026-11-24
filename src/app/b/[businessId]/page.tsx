import { redirect } from "next/navigation";
import { getBusinessContext } from "@/server/context";
import { menuPages } from "@/engine/layout";

export default async function BusinessHome({ params }: PageProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const { blueprint } = await getBusinessContext(businessId);
  const first = menuPages(blueprint)[0] ?? blueprint.pages[0];
  if (!first) return <p className="text-muted">This business has no pages yet.</p>;
  redirect(`/b/${businessId}/p/${first.id}`);
}
