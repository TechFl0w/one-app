import type { Block, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { calendarField, groupField, recordLabel, type Group, type LinkLabels } from "@/engine/blockData";
import { addDays, localToday, startOfWeek, zonedParts, isoDate } from "@/engine/dates";
import { formatDateTime, type FormatCtx } from "./format";
import { daysBetween, layoutLanes } from "@/engine/lanes";
import { OpenRecord } from "./RecordOpener";

const HOUR_PX = 56;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Day view: one column per group (e.g. per practitioner). Week view: one column per day.
 * options: { view: "day" | "week", startHour, endHour, durationMinutes, durationField, endField }.
 * Overlapping events sit side by side; date-only and multi-day jobs fill the all-day row.
 */
export function CalendarBlock({
  block,
  table,
  records,
  labels,
  groups,
  ctx,
  now = new Date(),
}: {
  block: Block;
  table: Table;
  records: RecordRow[];
  labels: LinkLabels;
  groups?: Group[];
  ctx: FormatCtx;
  now?: Date;
}) {
  const dateField = calendarField(table, block)!;
  const week = block.options?.view === "week";
  const startHour = num(block.options?.startHour, 8);
  const endHour = Math.max(startHour + 1, num(block.options?.endHour, 20));
  const defaultMinutes = num(block.options?.durationMinutes, 60);
  const durationField = table.fields.find((f) => f.id === block.options?.durationField && f.type === "number");
  const gf: Field | undefined = week ? undefined : groupField(table, block);

  // An end field (a job's end date or time) makes multi-day jobs span their days.
  const endField = table.fields.find((f) => f.id === block.options?.endField && (f.type === "date" || f.type === "datetime"));
  const dayOf = (raw: string) => (raw.length === 10 ? raw : isoDate(zonedParts(new Date(raw), ctx.timezone)));

  type Placed = { r: RecordRow; top: number; height: number; time: string; lane: number; lanes: number };
  type AllDay = { r: RecordRow; label: string };
  const timed: (Omit<Placed, "lane" | "lanes"> & { day: string; start: number; end: number })[] = [];
  const allDay: (AllDay & { day: string })[] = [];
  for (const r of records) {
    const raw = r.data[dateField.id];
    if (typeof raw !== "string") continue;
    const endRaw = endField && typeof r.data[endField.id] === "string" ? String(r.data[endField.id]) : undefined;
    const startDay = dayOf(raw);
    const endDay = endRaw ? dayOf(endRaw) : startDay;
    // Date-only and multi-day jobs sit in the all-day row of every day they cover.
    if (dateField.type === "date" || endDay > startDay) {
      const days = daysBetween(startDay, endDay);
      days.forEach((d, i) => allDay.push({ r, day: d, label: days.length > 1 ? `Day ${i + 1} of ${days.length}` : dateField.type === "date" ? "All day" : formatDateTime(raw, ctx, "time") }));
      continue;
    }
    const p = zonedParts(new Date(raw), ctx.timezone);
    const minutes = (p.hour - startHour) * 60 + p.minute;
    const endMs = endRaw ? Date.parse(endRaw) : NaN;
    const duration = Number.isFinite(endMs) && endMs > Date.parse(raw) ? (endMs - Date.parse(raw)) / 60_000 : durationField ? num(r.data[durationField.id], defaultMinutes) : defaultMinutes;
    const top = Math.max(0, (minutes / 60) * HOUR_PX);
    timed.push({ r, top, height: Math.max(22, (duration / 60) * HOUR_PX - 4), time: formatDateTime(raw, ctx, "time"), day: startDay, start: minutes, end: minutes + Math.max(duration, 20) });
  }

  // Overlapping events share their column side by side; a double booking is shown, never hidden.
  const laid = (list: typeof timed): Placed[] => layoutLanes(list);
  let columns: { key: string; label: string; items: Placed[]; allDay: AllDay[] }[];
  if (week) {
    const start = startOfWeek(localToday(now, ctx.timezone));
    columns = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const key = isoDate(d);
      return { key, label: formatDateTime(`${key}T12:00:00Z`, { ...ctx, timezone: "UTC" }, "date"), items: laid(timed.filter((p) => p.day === key)), allDay: allDay.filter((x) => x.day === key) };
    });
  } else {
    const todayKey0 = isoDate(localToday(now, ctx.timezone));
    const today = { timed: timed.filter((p) => p.day === todayKey0), allDay: allDay.filter((x) => x.day === todayKey0) };
    if (gf && groups) {
      const known = new Set(groups.map((g) => g.id));
      const inGroup = (r: RecordRow, id: string | null) => (Array.isArray(r.data[gf.id]) ? (r.data[gf.id] as unknown[]).includes(id) : r.data[gf.id] === id);
      columns = groups.map((g) => ({ key: g.id ?? "_", label: g.label, items: laid(today.timed.filter((p) => inGroup(p.r, g.id))), allDay: today.allDay.filter((x) => inGroup(x.r, g.id)) }));
      const none = (r: RecordRow) => { const v = r.data[gf.id]; return Array.isArray(v) ? !v.some((x) => known.has(x as string)) : !known.has(v as string); };
      const rest = today.timed.filter((p) => none(p.r));
      const restAll = today.allDay.filter((x) => none(x.r));
      if (rest.length || restAll.length) columns.push({ key: "_none", label: "Unassigned", items: laid(rest), allDay: restAll });
    } else {
      columns = [{ key: "all", label: formatDateTime(now.toISOString(), ctx, "date"), items: laid(today.timed), allDay: today.allDay }];
    }
  }
  const hasAllDay = columns.some((c) => c.allDay.length);
  const allDayRows = Math.max(0, ...columns.map((c) => c.allDay.length));

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_PX;
  const nowParts = zonedParts(now, ctx.timezone);
  const nowTop = ((nowParts.hour - startHour) * 60 + nowParts.minute) / 60 * HOUR_PX;
  const todayKey = isoDate(nowParts);

  return (
    <div className="h-full overflow-auto px-5 pb-5">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-12 shrink-0 bg-card pt-8" style={hasAllDay ? { paddingTop: 32 + allDayRows * 26 + 8 } : undefined}>
          {hours.map((h) => (
            <div key={h} className="relative text-[11px] text-muted" style={{ height: HOUR_PX }}>
              <span className="absolute -top-2">{new Intl.DateTimeFormat(ctx.locale ?? "en-CA", { hour: "numeric", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, h))}</span>
            </div>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.key} className="min-w-36 flex-1 border-l border-line/70">
            <div className="sticky top-0 z-10 bg-card">
              <div className="h-8 truncate px-2 text-xs font-semibold leading-8">{c.label}</div>
              {hasAllDay && (
                <div className="space-y-0.5 px-1 pb-2" style={{ minHeight: allDayRows * 26 + 8 }}>
                  {c.allDay.map(({ r, label }) => (
                    <OpenRecord key={r.id} table={table.id} recordId={r.id} className="block truncate rounded-md bg-accent px-2 py-0.5 text-xs font-semibold text-white hover:brightness-110" title={`${label} · ${recordLabel(table, r, labels)}`}>
                      {recordLabel(table, r, labels)} <span className="font-normal opacity-80">· {label}</span>
                    </OpenRecord>
                  ))}
                </div>
              )}
            </div>
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <div key={h} className="border-t border-line/50" style={{ height: HOUR_PX }} />
              ))}
              {(!week || c.key === todayKey) && nowTop >= 0 && nowTop <= height && (
                <div className="absolute inset-x-0 z-[5] border-t-2 border-accent/70" style={{ top: nowTop }} aria-hidden />
              )}
              {c.items.map(({ r, top, height: h, time, lane, lanes }) => (
                <OpenRecord
                  key={r.id}
                  table={table.id}
                  recordId={r.id}
                  className="absolute overflow-hidden rounded-lg border-l-[3px] border-accent bg-accent-tint px-2 py-1 text-xs ring-1 ring-card hover:z-[6] hover:brightness-95"
                  style={{ top, height: h, left: `calc(${(lane / lanes) * 100}% + 4px)`, width: `calc(${100 / lanes}% - 8px)` }}
                  title={`${time} · ${recordLabel(table, r, labels)}`}
                >
                  <p className="truncate font-semibold text-accent">{recordLabel(table, r, labels)}</p>
                  <p className="truncate text-muted">{time}</p>
                </OpenRecord>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
