import type { Page } from "@/schema/blueprint";
import { resolveLayout, type Device } from "@/engine/layout";
import { PageIcon } from "@/components/shell/Icon";
import { BlockView, type BlockEnv } from "@/components/blocks/BlockView";
import { PageGrid } from "./PageGrid";

export function PageView({
  page,
  device,
  userId,
  env,
}: {
  page: Page;
  device: Device;
  userId?: string;
  env: BlockEnv;
}) {
  const layout = resolveLayout(page, { device, userId });
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-6 flex items-center gap-3">
        <PageIcon name={page.icon} className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold tracking-tight">{page.label}</h1>
      </div>
      <PageGrid layout={layout} renderBlock={(b) => <BlockView block={b} env={env} />} />
    </div>
  );
}
