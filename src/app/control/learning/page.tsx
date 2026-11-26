import { loadInsights } from "@/server/control";
import { Decide } from "./Decide";

const KIND: Record<string, string> = { field: "Field", table: "Table", page: "Page", block: "Block", rename: "Rename", option: "Option", layout: "Layout", component: "Custom screen", automation: "Automation", theme: "Look", remove: "Removed" };

/**
 * What owners change after setup, per kind of business, ranked by how many did it. Approving a
 * pattern teaches the builder (it suggests it to owners of that type) or — for fields — puts it in
 * the template so new businesses start with it.
 */
export default async function Learning({ searchParams }: PageProps<"/control/learning">) {
  const { insights, types } = await loadInsights();
  const want = (await searchParams).type;
  const type = typeof want === "string" && types.some((t) => t.type === want) ? want : undefined;
  const shown = insights.filter((i) => !type || i.businessType === type).slice(0, 300);
  const groups = [...new Set(shown.map((i) => i.businessType))];
  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 px-4 py-8 md:px-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Learning</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          What owners (and the assistant on their behalf) changed after their app was set up, by kind of business. The more businesses made the same change, the more likely the
          template should have had it. <b>Teach the builder</b> makes the assistant suggest it to owners of that kind; <b>Add to template</b> gives new businesses the field from the start.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Kinds of business">
        <a href="/control/learning" className={`rounded-full px-3 py-1 text-sm ${!type ? "bg-ink text-white" : "bg-card shadow-soft"}`}>All</a>
        {types.map((t) => (
          <a key={t.type} href={`/control/learning?type=${encodeURIComponent(t.type)}`} className={`rounded-full px-3 py-1 text-sm ${type === t.type ? "bg-ink text-white" : "bg-card shadow-soft"}`}>
            {t.type} <b>{t.count}</b>
          </a>
        ))}
      </nav>
      {!shown.length && <p className="card p-8 text-center text-muted">No changes yet — once owners start reshaping their apps, the patterns show up here.</p>}
      {groups.map((g) => (
        <section key={g} className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 font-bold">
            {g} <span className="font-normal text-muted">· {types.find((t) => t.type === g)?.count ?? 0} businesses</span>
          </h2>
          <ul className="divide-y divide-line/60">
            {shown.filter((i) => i.businessType === g).map((i) => (
              <li key={i.key} className={`flex flex-wrap items-center gap-3 px-5 py-3 ${i.decision?.status === "dismissed" ? "opacity-50" : ""}`}>
                <span className="w-24 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted">{KIND[i.kind] ?? i.kind}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{i.text}</span>
                  <span className="text-xs text-muted">
                    {i.businesses} of {types.find((t) => t.type === g)?.count ?? 0} businesses ({Math.round(i.share * 100)}%){i.byAssistant ? ` · ${i.byAssistant} via the assistant` : ""}
                  </span>
                </span>
                <span className="h-2 w-24 overflow-hidden rounded-full bg-ground" aria-hidden>
                  <span className="block h-full bg-accent" style={{ width: `${Math.max(4, Math.round(i.share * 100))}%` }} />
                </span>
                <Decide input={{ businessType: i.businessType, pattern: i.key, kind: i.kind, text: i.text, payload: i.payload, businesses: i.businesses }} status={i.decision?.status} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
