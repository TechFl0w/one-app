import type { Block, Field, Table } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { calendarField, groupField, recordLabel, type Group, type LinkLabels } from "@/engine/blockData";
import { addDays, localToday, startOfWeek, zonedParts, isoDate } from "@/engine/dates";
import { formatDateTime, type FormatCtx } from "./format";
import { OpenRecord } from "./RecordOpener";

const HOUR_PX = 56;

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Day view: one column per group (e.g. per practitioner). Week view: one column per day.
 * options: { view: "day" | "week", startHour, endHour, durationMinutes, durationField }
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

  type Placed = { r: RecordRow; top: number; height: number; time: string };
  const place = (r: RecordRow): (Placed & { day: string }) | null => {
    const raw = r.data[dateField.id];
    if (typeof raw !== "string") return null;
    if (dateField.type === "date") return { r, top: 0, height: HOUR_PX / 2, time: "All day", day: raw };
    const p = zonedParts(new Date(raw), ctx.timezone);
    const minutes = (p.hour - startHour) * 60 + p.minute;
    const duration = durationField ? num(r.data[durationField.id], defaultMinutes) : defaultMinutes;
    return {
      r,
      top: Math.max(0, (minutes / 60) * HOUR_PX),
      height: Math.max(22, (duration / 60) * HOUR_PX - 4),
      time: formatDateTime(raw, ctx, "time"),
      day: isoDate(p),
    };
  };
  const placed = records.map(place).filter((x): x is NonNullable<typeof x> => !!x);

  let columns: { key: string; label: string; items: Placed[] }[];
  if (week) {
    const start = startOfWeek(localToday(now, ctx.timezone));
    columns = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i);
      const key = isoDate(d);
      return { key, label: formatDateTime(`${key}T12:00:00Z`, { ...ctx, timezone: "UTC" }, "date"), items: placed.filter((p) => p.day === key) };
    });
  } else if (gf && groups) {
    const known = new Set(groups.map((g) => g.id));
    columns = groups.map((g) => ({ key: g.id ?? "_", label: g.label, items: placed.filter((p) => p.r.data[gf.id] === g.id) }));
    const rest = placed.filter((p) => !known.has(p.r.data[gf.id] as string));
    if (rest.length) columns.push({ key: "_none", label: "Unassigned", items: rest });
  } else {
    columns = [{ key: "all", label: formatDateTime(now.toISOString(), ctx, "date"), items: placed }];
  }

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_PX;
  const nowParts = zonedParts(now, ctx.timezone);
  const nowTop = ((nowParts.hour - startHour) * 60 + nowParts.minute) / 60 * HOUR_PX;
  const todayKey = isoDate(nowParts);

  return (
    <div className="h-full overflow-auto px-5 pb-5">
      <div className="flex min-w-max">
        <div className="sticky left-0 z-10 w-12 shrink-0 bg-card pt-8">
          {hours.map((h) => (
            <div key={h} className="relative text-[11px] text-muted" style={{ height: HOUR_PX }}>
              <span className="absolute -top-2">{new Intl.DateTimeFormat(ctx.locale ?? "en-CA", { hour: "numeric", timeZone: "UTC" }).format(Date.UTC(2000, 0, 1, h))}</span>
            </div>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.key} className="min-w-36 flex-1 border-l border-line/70">
            <div className="sticky top-0 z-10 h-8 truncate bg-card px-2 text-xs font-semibold leading-8">{c.label}</div>
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <div key={h} className="border-t border-line/50" style={{ height: HOUR_PX }} />
              ))}
              {(!week || c.key === todayKey) && nowTop >= 0 && nowTop <= height && (
                <div className="absolute inset-x-0 z-[5] border-t-2 border-accent/70" style={{ top: nowTop }} aria-hidden />
              )}
              {c.items.map(({ r, top, height: h, time }) => (
                <OpenRecord
                  key={r.id}
                  table={table.id}
                  recordId={r.id}
                  className="absolute inset-x-1 overflow-hidden rounded-lg border-l-[3px] border-accent bg-accent-tint px-2 py-1 text-xs hover:brightness-95"
                  style={{ top, height: h }}
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
