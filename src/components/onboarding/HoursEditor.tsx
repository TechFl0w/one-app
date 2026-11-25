"use client";

import { Copy } from "lucide-react";
import { Select, timeOptions } from "@/components/ui/Select";

const TIMES = timeOptions(15);
import type { WeeklyHours } from "@/schema/blueprint";

const DAYS = [
  ["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"],
] as const;
type Day = (typeof DAYS)[number][0];

/** Opening hours: each day open or closed, with its own times. Value is WeeklyHours as JSON. */
export function HoursEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let hours: WeeklyHours = {};
  try {
    hours = JSON.parse(value) as WeeklyHours;
  } catch {
    // keep empty
  }
  const set = (next: WeeklyHours) => onChange(JSON.stringify(next));
  const range = (d: Day): [string, string] => (hours[d]?.[0] as [string, string] | undefined) ?? ["09:00", "17:00"];
  const toggle = (d: Day) => {
    const next = { ...hours };
    if (next[d]?.length) delete next[d];
    else next[d] = [lastOpen()];
    set(next);
  };
  const lastOpen = (): [string, string] => {
    const open = DAYS.map(([d]) => hours[d]?.[0]).filter(Boolean);
    return (open[open.length - 1] as [string, string] | undefined) ?? ["09:00", "17:00"];
  };
  const time = (d: Day, i: 0 | 1, v: string) => {
    const r = range(d);
    r[i] = v;
    set({ ...hours, [d]: [r] });
  };
  const copyToAll = (d: Day) => {
    const r = range(d);
    const next: WeeklyHours = {};
    for (const [day] of DAYS) if (hours[day]?.length) next[day] = [[r[0], r[1]]];
    set(next);
  };
  const bad = (d: Day) => hours[d]?.length && range(d)[0] >= range(d)[1];

  return (
    <div className="space-y-2">
      {DAYS.map(([d, label]) => {
        const open = !!hours[d]?.length;
        return (
          <div key={d} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-2.5 ${open ? "border-line" : "border-line/60 bg-ground"}`}>
            <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={open} onChange={() => toggle(d)} />
              {label}
            </label>
            {open ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm sm:flex-nowrap">
                <Select size="sm" className="w-32" value={range(d)[0]} onChange={(v) => time(d, 0, v as string)} options={TIMES} searchable={false} ariaLabel={`${label} opens`} />
                <span className="text-muted">to</span>
                <Select size="sm" className="w-32" value={range(d)[1]} onChange={(v) => time(d, 1, v as string)} options={TIMES} searchable={false} ariaLabel={`${label} closes`} />
                <button type="button" className="ml-auto rounded-full p-1.5 text-muted hover:bg-ground hover:text-ink" title="Use these times for every open day" aria-label={`Use ${label}’s times for every open day`} onClick={() => copyToAll(d)}>
                  <Copy className="h-4 w-4" />
                </button>
                {bad(d) && <span className="w-full text-xs text-red-700">Closing time must be after opening time.</span>}
              </div>
            ) : (
              <span className="text-sm text-muted">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
