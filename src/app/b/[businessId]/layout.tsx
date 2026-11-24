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
        <form action={signOut}>
          <button className="btn-ghost w-full">Sign out</button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
