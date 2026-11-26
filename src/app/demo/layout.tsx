import Link from "next/link";
import { CalendarCheck, Inbox, Zap } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { currentDemo } from "@/demo/current";
import { demoSandboxCreate, demoSandboxGet, demoSandboxList, demoSandboxRemove, demoSandboxUpdate } from "./sandbox-actions";

/** Sample salon running on in-memory data — no account or Supabase needed. */
// The assistant's server actions run here: rebuilding pages from a design can take a few minutes.
export const maxDuration = 300;

export default async function DemoLayout({ children }: LayoutProps<"/demo">) {
  const demo = await currentDemo();
  return (
    <AppShell
      blueprint={demo.blueprint}
      mode={{ kind: "local" }}
      basePath="/demo"
      sandbox={{ list: demoSandboxList, get: demoSandboxGet, create: demoSandboxCreate, update: demoSandboxUpdate, remove: demoSandboxRemove }}
      footer={
        <div className="space-y-1">
          <Link href="/demo/inbox" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Inbox className="h-4 w-4" /> Inbox
            <span className="ml-auto rounded-full bg-accent px-2 text-xs font-semibold text-white">1</span>
          </Link>
          {/* Only businesses that take online bookings have a public booking page. */}
          {demo.blueprint.scheduling && (
            <Link href="/book/demo" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
              <CalendarCheck className="h-4 w-4" /> Booking page
            </Link>
          )}
          <Link href="/demo/automations" className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Zap className="h-4 w-4" /> Automations
          </Link>
        </div>
      }
      banner={
        <div className="border-b border-line bg-accent-tint px-4 py-2 text-center text-sm text-accent md:px-8">
          {demo.type === "salon" ? "Demo salon" : `Demo: ${demo.blueprint.business.name}`} with sample data. <Link href="/login" className="font-semibold underline">Create your own</Link>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
