"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { Select, timeOptions } from "./Select";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Our date (and optional time) picker. Value: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local, like
 * the native inputs it replaces, so server-side parsing is unchanged). Posts via `name`.
 */
export function DatePicker({ name, id, withTime = false, required, defaultValue = "" }: { name: string; id?: string; withTime?: boolean; required?: boolean; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const date = value.slice(0, 10);
  const time = value.slice(11, 16) || "09:00";
  const today = new Date();
  const [view, setView] = useState(() => {
    const d = date ? new Date(`${date}T12:00:00`) : today;
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const set = (d: string, t = time) => setValue(withTime ? `${d}T${t}` : d);
  const first = new Date(view.y, view.m, 1);
  const offset = (first.getDay() + 6) % 7; // weeks start Monday
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const month = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first);
  const shown = date ? new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`)) : "";
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const move = (n: number) => setView((v) => ({ y: v.y + Math.floor((v.m + n) / 12), m: (v.m + n + 12) % 12 }));

  return (
    <div ref={root} className="flex gap-2" onKeyDown={(e) => open && e.key === "Escape" && (e.preventDefault(), setOpen(false))}>
      <input type="hidden" name={name} value={date ? value : ""} />
      {required && !date && <input tabIndex={-1} aria-hidden className="pointer-events-none absolute opacity-0" required value="" onChange={() => {}} />}
      <div className="relative flex-1">
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={`relative w-full rounded-xl border bg-card py-2.5 pl-11 pr-11 text-left text-sm outline-none ${open ? "border-accent ring-2 ring-accent-tint" : "border-line hover:border-ink/25"}`}
        >
          <CalendarDays className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <span className={date ? "" : "text-muted"}>{shown || "Pick a date"}</span>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        </button>
        {open && (
          <div role="dialog" aria-label="Choose a date" className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-2xl border border-line bg-card p-3 shadow-lg">
            <div className="mb-2 flex items-center">
              <button type="button" className="rounded-full p-1.5 hover:bg-ground" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
              <span className="flex-1 text-center text-sm font-semibold">{month}</span>
              <button type="button" className="rounded-full p-1.5 hover:bg-ground" onClick={() => move(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d}>{d}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: offset }, (_, i) => <span key={`x${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const d = iso(view.y, view.m, i + 1);
                const on = d === date;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      set(d);
                      setOpen(false);
                    }}
                    className={`h-9 rounded-full text-sm ${on ? "bg-accent font-semibold text-white" : d === todayIso ? "font-semibold text-accent hover:bg-ground" : "hover:bg-ground"}`}
                    aria-pressed={on}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm">
              <button type="button" className="rounded-full px-3 py-1 text-accent hover:bg-ground" onClick={() => { set(todayIso); setView({ y: today.getFullYear(), m: today.getMonth() }); setOpen(false); }}>Today</button>
              {date && !required && <button type="button" className="rounded-full px-3 py-1 text-muted hover:bg-ground" onClick={() => { setValue(""); setOpen(false); }}>Clear</button>}
            </div>
          </div>
        )}
      </div>
      {withTime && (
        <Select className="w-36" value={time} onChange={(t) => set(date || todayIso, t as string)} options={timeOptions(15)} ariaLabel="Time" searchable={false} />
      )}
    </div>
  );
}
