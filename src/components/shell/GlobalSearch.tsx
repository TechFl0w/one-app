"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useSandbox } from "@/components/sandbox/SandboxProvider";

type Hit = { table: string; tableLabel: string; id: string; title: string };

/**
 * Search everything (⌘K / Ctrl+K, or the box in the menu): clients, jobs, invoices, pets… by any
 * of their values; Enter opens the record.
 */
/** The "Search" box in the menu: opens the one search dialog of the app. */
export function SearchButton({ onClick }: { onClick?: () => void }) {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button type="button" onClick={() => { onClick?.(); window.dispatchEvent(new Event("one:search")); }} className="mb-3 flex w-full items-center gap-2 rounded-full border border-line bg-ground px-4 py-2 text-sm text-muted hover:text-ink">
      <Search className="h-4 w-4" /> Search
      <kbd className="ml-auto rounded-md border border-line px-1.5 text-[11px]" suppressHydrationWarning>{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

export function GlobalSearch() {
  const sandbox = useSandbox();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const search = sandbox?.bridge.search;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", key);
    window.addEventListener("one:search", show);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("one:search", show);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  if (!search || !sandbox) return null;
  const run = (v: string) => {
    setQ(v);
    setActive(0);
    const n = ++seq.current;
    if (v.trim().length < 2) return setHits([]);
    setBusy(true);
    setTimeout(async () => {
      if (n !== seq.current) return;
      const r = await search(v);
      if (n !== seq.current) return;
      setBusy(false);
      setHits(r.ok ? r.value : []);
    }, 200);
  };
  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(`${sandbox.basePath}/r/${h.table}/${h.id}`);
  };
  const groups = [...new Set(hits.map((h) => h.tableLabel))];

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-ink/30 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-card shadow-soft" role="dialog" aria-label="Search">
            <label className="flex items-center gap-3 border-b border-line px-4 py-3">
              <Search className="h-5 w-5 text-muted" />
              <input
                ref={input}
                value={q}
                onChange={(e) => run(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === "Enter" && hits[active]) go(hits[active]);
                }}
                placeholder="Search clients, jobs, invoices…"
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
                aria-label="Search everything"
              />
              <kbd className="rounded-md border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
            </label>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {q.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Type a name, phone number, address or anything else.</p>
              ) : busy && !hits.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Searching…</p>
              ) : !hits.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Nothing found for “{q}”.</p>
              ) : (
                groups.map((g) => (
                  <div key={g} className="mb-1">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted">{g}</p>
                    {hits.filter((h) => h.tableLabel === g).map((h) => {
                      const i = hits.indexOf(h);
                      return (
                        <button key={`${h.table}:${h.id}`} type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm ${i === active ? "bg-accent-tint text-accent" : "hover:bg-ground"}`}>
                          <span className="truncate font-medium">{h.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
