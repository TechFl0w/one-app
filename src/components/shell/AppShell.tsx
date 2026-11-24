import type { Blueprint } from "@/schema/blueprint";
import { menuPages } from "@/engine/layout";
import { Sidebar } from "./Sidebar";

export function AppShell({
  blueprint,
  basePath,
  businesses,
  footer,
  banner,
  children,
}: {
  blueprint: Blueprint;
  basePath: string;
  businesses?: { id: string; name: string }[];
  footer?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pages = menuPages(blueprint).map(({ id, label, icon }) => ({ id, label, icon }));
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <Sidebar
        businessName={blueprint.business.name}
        basePath={basePath}
        pages={pages}
        businesses={businesses}
        footer={footer}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
