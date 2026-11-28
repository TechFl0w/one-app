"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  text: string;
  /** Built and ready: a link to connect it. Otherwise owners can ask for it. */
  href?: string;
  requested?: boolean;
}

/** Every integration, by category: connect what's ready, ask for what isn't (so we build it next). */
export function IntegrationCatalog({ items, request }: { items: CatalogItem[]; request: (id: string) => Promise<void> }) {
  const [asked, setAsked] = useState<Set<string>>(new Set(items.filter((i) => i.requested).map((i) => i.id)));
  const [, start] = useTransition();
  const [filter, setFilter] = useState("All");
  const cats = ["All", ...new Set(items.map((i) => i.category))];
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} type="button" onClick={() => setFilter(c)} className={`rounded-full px-3 py-1 text-sm ${filter === c ? "bg-accent text-white" : "bg-card text-muted hover:text-ink"}`}>{c}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.filter((i) => filter === "All" || i.category === filter).map((i) => (
          <div key={i.id} className="card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint text-sm font-extrabold text-accent">{i.name.slice(0, 1)}</span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{i.name}</p>
                <p className="text-xs text-muted">{i.category}</p>
              </div>
            </div>
            <p className="flex-1 text-sm text-muted">{i.text}</p>
            {i.href ? (
              <a href={i.href} className="btn-primary self-start px-4 py-1.5 text-sm">Connect</a>
            ) : asked.has(i.id) ? (
              <p className="flex items-center gap-1.5 text-sm font-semibold text-accent"><Check className="h-4 w-4" /> We’ll let you know when it’s ready</p>
            ) : (
              <button type="button" className="btn-ghost self-start px-4 py-1.5 text-sm" onClick={() => { setAsked((s) => new Set(s).add(i.id)); start(() => request(i.id)); }}>
                I want this
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
