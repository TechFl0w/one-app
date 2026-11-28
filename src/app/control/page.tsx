import Link from "next/link";
import { listApps } from "@/server/control";
import { createAdminClient } from "@/lib/supabase/admin";

const when = (iso?: string) => (iso ? new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "—");

/** Every app on One App: what it is, how big, how much its owner reshaped it. */
export default async function ControlApps() {
  const apps = await listApps();
  const byType = [...apps.reduce((m, a) => m.set(a.type, (m.get(a.type) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const changed = apps.filter((a) => a.ownerChanges + a.aiChanges > 0).length;
  // Integrations owners asked for (Settings › Integrations › "I want this"), most asked first.
  const { data: reqs } = await createAdminClient().from("integration_requests").select("integration");
  const wanted = [...(reqs ?? []).reduce((m, r) => m.set(r.integration as string, (m.get(r.integration as string) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Apps</h1>
        <p className="mt-1 text-sm text-muted">Every app users have built. Open one to see it with made-up data (their real records are never shown) and how it changed since setup.</p>
      </div>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["Apps", apps.length],
          ["Changed after setup", changed],
          ["Custom screens", apps.reduce((a, x) => a + x.components, 0)],
          ["Owner + AI changes", apps.reduce((a, x) => a + x.ownerChanges + x.aiChanges, 0)],
        ].map(([label, n]) => (
          <div key={label} className="card px-5 py-4">
            <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums">{n}</p>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        {byType.map(([t, n]) => (
          <span key={t} className="rounded-full bg-card px-3 py-1 text-sm shadow-soft">
            {t} <b>{n}</b>
          </span>
        ))}
      </div>
      {wanted.length > 0 && (
        <div className="card px-5 py-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Integrations owners asked for</p>
          <div className="flex flex-wrap gap-2">
            {wanted.map(([id, n]) => (
              <span key={id} className="rounded-full bg-ground px-3 py-1 text-sm">{id.replace(/_/g, " ")} <b>{n}</b></span>
            ))}
          </div>
        </div>
      )}
      <section className="card overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              {["Business", "Type", "Created", "Pages", "Tables", "Screens", "Automations", "Records", "Owner changes", "AI changes", "Last change"].map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id} className="border-b border-line/60 hover:bg-ground/60">
                <td className="px-4 py-2.5 font-semibold">
                  <Link href={`/control/apps/${a.id}`} className="text-accent hover:underline">{a.name}</Link>
                </td>
                <td className="px-4 py-2.5">{a.type}</td>
                <td className="px-4 py-2.5 text-muted">{when(a.createdAt)}</td>
                {[a.pages, a.tables, a.components, a.automations, a.records, a.ownerChanges, a.aiChanges].map((n, i) => (
                  <td key={i} className="px-4 py-2.5 tabular-nums">{n}</td>
                ))}
                <td className="px-4 py-2.5 text-muted">{when(a.lastChangeAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!apps.length && <p className="p-8 text-center text-muted">No apps yet.</p>}
      </section>
    </main>
  );
}
