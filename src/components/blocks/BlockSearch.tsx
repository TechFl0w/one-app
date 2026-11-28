"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";

export interface FilterField {
  id: string;
  label: string;
  options: { value: string; label: string }[];
}

/**
 * Search box and filters above a table or list. They live in the page address, so the server
 * loads exactly what's shown (also beyond the first page of records) and a filtered view can be
 * bookmarked or shared.
 */
export function BlockSearch({ blockId, fields, q, active }: { blockId: string; fields: FilterField[]; q?: string; active: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [text, setText] = useState(q ?? "");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(`${blockId}.${k}`, v);
      else next.delete(`${blockId}.${k}`);
    }
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };
  const typed = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 300);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const chips = Object.entries(active).map(([id, v]) => {
    const f = fields.find((x) => x.id === id);
    return { id, label: `${f?.label ?? id}: ${f?.options.find((o) => o.value === v)?.label ?? v}` };
  });
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 pb-2">
      <label className={`flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-ground px-3 py-1.5 text-sm focus-within:border-accent ${pending ? "opacity-70" : ""}`}>
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <input value={text} onChange={(e) => typed(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Search" />
        {text && <button type="button" onClick={() => typed("")} aria-label="Clear search" className="text-muted hover:text-ink"><X className="h-4 w-4" /></button>}
      </label>
      {fields.length > 0 && (
        <div ref={box} className="relative">
          <button type="button" onClick={() => setOpen((o) => !o)} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${chips.length ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`} aria-expanded={open}>
            <Filter className="h-4 w-4" /> Filter{chips.length ? ` · ${chips.length}` : ""}
          </button>
          {open && (
            <div className="absolute right-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-2xl border border-line bg-card p-2 shadow-soft">
              {fields.map((f) => (
                <div key={f.id} className="mb-2">
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted">{f.label}</p>
                  <div className="flex flex-wrap gap-1 px-1">
                    {f.options.map((o) => {
                      const on = active[f.id] === o.value;
                      return (
                        <button key={o.value} type="button" onClick={() => go({ [f.id]: on ? null : o.value })} className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-accent text-white" : "bg-ground hover:bg-accent-tint"}`}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {chips.map((c) => (
        <button key={c.id} type="button" onClick={() => go({ [c.id]: null })} className="flex items-center gap-1 rounded-full bg-accent-tint px-2.5 py-1 text-xs font-medium text-accent hover:brightness-95">
          {c.label} <X className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}
