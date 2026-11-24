import Link from "next/link";
import { CalendarCheck, CreditCard, History, Inbox, Mail, Zap } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { getBusinessContext } from "@/server/context";
import { signOut } from "@/app/login/actions";
import { loadConversation } from "@/server/ownerChat";

export default async function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const { blueprint, businesses, supabase, userId } = await getBusinessContext(businessId);
  const { count } = await supabase
    .from("inbox_messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("read_at", null);
  const unread = count ?? 0;
  const { transcript } = userId ? await loadConversation(supabase, businessId, userId).catch(() => ({ transcript: [] })) : { transcript: [] };
  return (
    <AppShell
      blueprint={blueprint}
      mode={{ kind: "server", businessId }}
      basePath={`/b/${businessId}`}
      businesses={businesses}
      transcript={transcript}
      footer={
        <div className="space-y-2">
          <Link href={`/b/${businessId}/inbox`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Inbox className="h-4 w-4" /> Inbox
            {unread > 0 && <span className="ml-auto rounded-full bg-accent px-2 text-xs font-semibold text-white">{unread}</span>}
          </Link>
          <Link href={`/b/${businessId}/automations`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Zap className="h-4 w-4" /> Automations
          </Link>
          {blueprint.scheduling && (
            <Link href={`/b/${businessId}/settings/booking`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
              <CalendarCheck className="h-4 w-4" /> Online booking
            </Link>
          )}
          <Link href={`/b/${businessId}/settings/payments`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <CreditCard className="h-4 w-4" /> Payments
          </Link>
          <Link href={`/b/${businessId}/settings/email`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <Mail className="h-4 w-4" /> Email settings
          </Link>
          <Link href={`/b/${businessId}/activity`} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-muted hover:bg-ground hover:text-ink">
            <History className="h-4 w-4" /> Activity
          </Link>
          <form action={signOut}>
            <button className="btn-ghost w-full">Sign out</button>
          </form>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
