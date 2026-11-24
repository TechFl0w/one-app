import type { Page } from "@/schema/blueprint";
import type { Device } from "@/engine/layout";
import { BlockView, type BlockEnv } from "@/components/blocks/BlockView";
import { EditablePage } from "./EditablePage";

/** Server part of a page: renders every block's content, then hands layout to EditablePage. */
export function PageView({ page, device, userId, env }: { page: Page; device: Device; userId?: string; env: BlockEnv }) {
  const blocks = new Map(
    [page.layout.blocks, ...Object.values(page.layoutOverrides ?? {}).map((o) => o?.blocks ?? [])].flat().map((b) => [b.id, b]),
  );
  const rendered = Object.fromEntries([...blocks.values()].map((b) => [b.id, <BlockView key={b.id} block={b} env={env} />]));
  return <EditablePage pageId={page.id} device={device} userId={userId} rendered={rendered} />;
}
