import { redirect } from "next/navigation";
import { previewApp } from "@/server/preview";
import { menuPages } from "@/engine/layout";

export default async function PreviewHome({ params }: PageProps<"/control/apps/[id]/preview">) {
  const { id } = await params;
  const { blueprint } = await previewApp(id);
  const first = menuPages(blueprint).find((p) => !p.recordOf);
  redirect(first ? `/control/apps/${id}/preview/p/${first.id}` : `/control/apps/${id}`);
}
