import Link from "next/link";
import { History } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { getBusinessContext } from "@/server/context";
import { signOut } from "@/app/login/actions";
import { loadConversation } from "@/server/ownerChat";

export default async function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const { blueprint, businesses, supabase, userId } = await getBusinessContext(businessId);
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
