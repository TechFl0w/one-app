import type { Field } from "@/schema/blueprint";
import type { LinkLabels } from "@/engine/blockData";
import { Check } from "lucide-react";

export interface FormatCtx {
  timezone: string;
  currency?: string;
  locale?: string;
}

const DEFAULT_LOCALE = "en-CA";

export function formatMoney(value: number, currency = "USD", locale = DEFAULT_LOCALE) {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
}

export function formatDateTime(iso: string, ctx: FormatCtx, style: "full" | "time" | "date" = "full") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions =
    style === "time"
      ? { hour: "numeric", minute: "2-digit" }
      : style === "date"
        ? { weekday: "short", month: "short", day: "numeric" }
        : { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(ctx.locale ?? DEFAULT_LOCALE, { ...opts, timeZone: ctx.timezone }).format(d);
}

export function formatDate(isoDate: string, ctx: FormatCtx) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? isoDate
    : new Intl.DateTimeFormat(ctx.locale ?? DEFAULT_LOCALE, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Plain-text rendering of a value (for titles, sorting labels, aria). */
export function valueText(field: Field, value: unknown, labels: LinkLabels, ctx: FormatCtx): string {
  if (value === undefined || value === null || value === "") return "";
  switch (field.type) {
    case "money":
      return formatMoney(Number(value), field.currency ?? ctx.currency, ctx.locale);
    case "number":
      return new Intl.NumberFormat(ctx.locale ?? DEFAULT_LOCALE).format(Number(value));
    case "datetime":
      return formatDateTime(String(value), ctx);
    case "date":
      return formatDate(String(value), ctx);
    case "checkbox":
      return value ? "Yes" : "No";
    case "status":
    case "choice": {
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((id) => field.options.find((o) => o.id === id)?.label ?? String(id)).join(", ");
    }
    case "link": {
      const ids = Array.isArray(value) ? value : [value];
      return ids.map((id) => labels[String(id)] ?? "—").join(", ");
    }
    case "hours":
      return hoursSummary(value as Record<string, [string, string][]>);
    case "file":
      return typeof value === "object" && value && "name" in value ? String((value as { name: unknown }).name) : "File";
    default:
      return String(value);
  }
}

export function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: color ? `${color}1A` : "var(--accent-tint)", color: color ?? "var(--accent)" }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color ?? "var(--accent)" }} />
      {label}
    </span>
  );
}

/** Rich rendering of a value inside tables, cards and lists. */
export function FieldValue({ field, value, labels, ctx }: { field: Field; value: unknown; labels: LinkLabels; ctx: FormatCtx }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) {
    return <span className="text-muted/50">—</span>;
  }
  switch (field.type) {
    case "status":
    case "choice": {
      const ids = (Array.isArray(value) ? value : [value]).map(String);
      return (
        <span className="inline-flex flex-wrap gap-1">
          {ids.map((id) => {
            const o = field.options.find((x) => x.id === id);
            return <Pill key={id} label={o?.label ?? id} color={o?.color} />;
          })}
        </span>
      );
    }
    case "checkbox":
      return value ? <Check className="h-4 w-4 text-accent" aria-label="Yes" /> : <span className="text-muted/50">—</span>;
    case "email":
      return <a className="hover:underline" href={`mailto:${value}`}>{String(value)}</a>;
    case "phone":
      return <a className="whitespace-nowrap hover:underline" href={`tel:${String(value).replace(/[^+\d]/g, "")}`}>{String(value)}</a>;
    case "money":
    case "number":
      return <span className="tabular-nums">{valueText(field, value, labels, ctx)}</span>;
    default:
      return <>{valueText(field, value, labels, ctx)}</>;
  }
}

const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** { mon:[["09:00","17:00"]], tue:… } → "Mon–Fri 09:00–17:00, Sat 10:00–14:00" */
export function hoursSummary(h: Record<string, [string, string][]> | null | undefined): string {
  if (!h || typeof h !== "object") return "";
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const key = (d: string) => (h[d] ?? []).map(([a, b]) => `${a}–${b}`).join(", ");
  const groups: { from: string; to: string; ranges: string }[] = [];
  for (const d of days) {
    const ranges = key(d);
    const last = groups.at(-1);
    if (ranges && last && last.ranges === ranges && days.indexOf(last.to) === days.indexOf(d) - 1) last.to = d;
    else if (ranges) groups.push({ from: d, to: d, ranges });
  }
  return groups.map((g) => `${DAY_LABEL[g.from]}${g.to !== g.from ? `–${DAY_LABEL[g.to]}` : ""} ${g.ranges}`).join("; ") || "Closed";
}
