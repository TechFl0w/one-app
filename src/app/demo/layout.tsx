import Link from "next/link";
import { Zap } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { demoBlueprint } from "@/demo/salon";

/** Sample salon running on in-memory data — no account or Supabase needed. */
export default function DemoLayout({ children }: LayoutProps<"/demo">) {
  return (
    <AppShell
      blueprint={demoBlueprint}
      mode={{ kind: "local" }}
      basePath="/demo"
      footer={
        <Link href="/demo/automations" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
          <Zap className="h-4 w-4" /> Automations
        </Link>
      }
      banner={
        <div className="border-b border-line bg-accent-tint px-4 py-2 text-center text-sm text-accent md:px-8">
          Demo salon with sample data. <Link href="/login" className="font-semibold underline">Create your own</Link>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
