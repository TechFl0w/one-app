import { AppShell } from "@/components/shell/AppShell";
import { getBusinessContext } from "@/server/context";
import { signOut } from "@/app/login/actions";

export default async function BusinessLayout({ children, params }: LayoutProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const { blueprint, businesses } = await getBusinessContext(businessId);
  return (
    <AppShell
      blueprint={blueprint}
      basePath={`/b/${businessId}`}
      businesses={businesses}
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
