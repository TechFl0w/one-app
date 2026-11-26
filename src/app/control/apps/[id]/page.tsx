import Link from "next/link";
import { Eye } from "lucide-react";
import { loadApp } from "@/server/control";
import { menuPages } from "@/engine/layout";
import { PageIcon } from "@/components/shell/Icon";
import { LayoutSketch } from "@/components/control/LayoutSketch";

const when = (iso: string) => new Intl.DateTimeFormat("en-CA", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const SOURCE: Record<string, string> = { ui: "Owner", ai: "Assistant", undo: "Undo", system: "System" };

/** One user's app: its pages, data model, automations, and every change since it was set up. */
export default async function ControlApp({ params }: PageProps<"/control/apps/[id]">) {
  const { id } = await params;
  const { business, blueprint: bp, history } = await loadApp(id);
  const pages = menuPages(bp).filter((p) => !p.recordOf);
  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <Link href="/control" className="text-sm text-muted hover:text-ink">‹ Apps</Link>
          <h1 className="text-3xl font-extrabold tracking-tight">{business.name}</h1>
          <p className="text-sm text-muted">
            {business.type} · created {when(business.created_at)} · version {bp.version} · {bp.tables.length} tables · {bp.components?.length ?? 0} custom screens · {bp.documents?.length ?? 0} documents
          </p>
        </div>
        <Link href={`/control/apps/${id}/preview`} className="btn-primary">
          <Eye className="h-4 w-4" /> Open with sample data
        </Link>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Pages</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {pages.map((p) => (
            <Link key={p.id} href={`/control/apps/${id}/preview/p/${p.id}`} className="card block p-4 transition hover:-translate-y-0.5">
              <p className="mb-3 flex items-center gap-2 font-semibold">
                <PageIcon name={p.icon} className="h-4 w-4 text-muted" /> {p.label}
                {p.badge && <span className="rounded-full bg-ground px-2 text-xs text-muted">count</span>}
              </p>
              <LayoutSketch blueprint={bp} blocks={p.layout.blocks} />
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-bold">Data</h2>
          <ul className="space-y-3 text-sm">
            {bp.tables.map((t) => (
              <li key={t.id}>
                <p className="font-semibold">{t.label}</p>
                <p className="text-muted">{t.fields.map((f) => `${f.label} (${f.type})`).join(" · ")}</p>
              </li>
            ))}
          </ul>
          {bp.automations.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 font-bold">Automations</h3>
              <ul className="space-y-1 text-sm">
                {bp.automations.map((a) => (
                  <li key={a.id} className={a.enabled ? "" : "text-muted line-through"}>{a.label}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-bold">Changes since setup</h2>
          {!history.length && <p className="text-sm text-muted">Not changed since it was set up.</p>}
          <ol className="space-y-2.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex gap-3">
                <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${h.source === "ai" ? "bg-[#F2EDFA] text-[#6B46C1]" : h.source === "ui" ? "bg-accent-tint text-accent" : "bg-ground text-muted"}`}>
                  {SOURCE[h.source] ?? h.source}
                </span>
                <span className="min-w-0">
                  <span className="block">{h.summary ?? "Changed the setup"}</span>
                  <span className="text-xs text-muted">{when(h.created_at)} · v{h.from_version} → v{h.to_version}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
