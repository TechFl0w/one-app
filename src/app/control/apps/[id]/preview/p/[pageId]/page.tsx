import { notFound } from "next/navigation";
import { withComputed } from "@/engine/computed";
import { memoryStore } from "@/engine/store";
import { getDevice } from "@/server/context";
import { previewApp } from "@/server/preview";
import { PageView } from "@/components/page/PageView";
import { previewCreate, previewGet, previewList, previewRemove, previewUpdate } from "../../../../../preview-actions";

export default async function PreviewPage({ params }: PageProps<"/control/apps/[id]/preview/p/[pageId]">) {
  const { id, pageId } = await params;
  const { blueprint, records } = await previewApp(id);
  const page = blueprint.pages.find((p) => p.id === pageId);
  if (!page) notFound();
  return (
    <PageView
      page={page}
      device={await getDevice()}
      env={{
        blueprint,
        store: withComputed(memoryStore(records), blueprint),
        formAction: () => async () => ({ ok: false, error: "This is a preview — nothing is saved." }),
        sandbox: { basePath: `/control/apps/${id}/preview`, bridge: { list: previewList.bind(null, id), get: previewGet.bind(null, id), create: previewCreate.bind(null, id), update: previewUpdate.bind(null, id), remove: previewRemove.bind(null, id) } },
      }}
    />
  );
}
