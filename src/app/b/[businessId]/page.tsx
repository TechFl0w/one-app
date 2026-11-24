import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBlueprint } from "@/server/blueprints";
import { ChangeSetError } from "@/engine/changeSet";
import { signOut } from "@/app/login/actions";

/** Placeholder shell; the real sidebar + block grid renderer is roadmap task 5. */
export default async function BusinessPage({ params }: PageProps<"/b/[businessId]">) {
  const { businessId } = await params;
  const supabase = await createClient();
  const blueprint = await getCurrentBlueprint(supabase, businessId).catch((e) => {
    if (e instanceof ChangeSetError && e.code === "not_found") notFound();
    throw e;
  });
  const menu = blueprint.pages.filter((p) => !p.hidden).sort((a, b) => a.menuOrder - b.menuOrder);

  return (
    <div className="flex flex-1">
      <aside className="flex w-60 flex-col border-r border-line bg-card p-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            {blueprint.business.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="truncate font-semibold">{blueprint.business.name}</span>
        </div>
        <nav className="flex-1 space-y-1">
          {menu.map((p, i) => (
            <div key={p.id} className={`rounded-full px-4 py-2 text-sm ${i === 0 ? "bg-accent-tint font-semibold text-accent" : "text-muted"}`}>
              {p.label}
            </div>
          ))}
        </nav>
        <form action={signOut}>
          <button className="btn-ghost w-full">Sign out</button>
        </form>
      </aside>
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold">{menu[0]?.label ?? "Home"}</h1>
        <div className="card mt-6 p-8 text-muted">
          Blueprint version {blueprint.version}. Pages and blocks render here once the shell is built.
        </div>
      </main>
    </div>
  );
}
