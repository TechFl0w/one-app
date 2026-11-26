import { AppShell } from "@/components/shell/AppShell";
import { forBrowser } from "@/server/clientBlueprint";
import { previewApp } from "@/server/preview";
import { menuCounts } from "@/engine/menuCounts";
import { withComputed } from "@/engine/computed";
import { memoryStore } from "@/engine/store";
import { previewCreate, previewGet, previewList, previewRemove, previewUpdate } from "../../../preview-actions";

/** A user's app exactly as it looks, filled with made-up records. Nothing here is saved. */
export default async function PreviewLayout({ children, params }: LayoutProps<"/control/apps/[id]/preview">) {
  const { id } = await params;
  const { blueprint, records } = await previewApp(id);
  const counts = await menuCounts(blueprint, withComputed(memoryStore(records), blueprint)).catch(() => ({}));
  return (
    <AppShell
      blueprint={forBrowser(blueprint)}
      mode={{ kind: "local" }}
      chat={false}
      counts={counts}
      basePath={`/control/apps/${id}/preview`}
      sandbox={{ list: previewList.bind(null, id), get: previewGet.bind(null, id), create: previewCreate.bind(null, id), update: previewUpdate.bind(null, id), remove: previewRemove.bind(null, id) }}
      banner={<div className="border-b border-line bg-[#F2EDFA] px-4 py-2 text-center text-sm text-[#6B46C1] md:px-8">Preview of {blueprint.business.name} with made-up data — nothing you do here is saved.</div>}
    >
      {children}
    </AppShell>
  );
}
