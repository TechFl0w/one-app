/**
 * Timezone helpers without a date library. A business has one IANA timezone; "today" etc. are
 * computed there, then turned into UTC instants for queries.
 */

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(instant: Date, tz: string) {
  const p = Object.fromEntries(formatter(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset (ms) of `tz` from UTC at `instant`. */
function offsetAt(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight at the start of `date` in `tz` (handles DST). */
export function startOfLocalDay(date: LocalDate, tz: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day);
  let guess = naive - offsetAt(new Date(naive), tz);
  guess = naive - offsetAt(new Date(guess), tz);
  return new Date(guess);
}

export function localToday(now: Date, tz: string): LocalDate {
  const { year, month, day } = zonedParts(now, tz);
  return { year, month, day };
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function isoDate(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Monday-based week start. */
export function startOfWeek(d: LocalDate): LocalDate {
  const dow = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0 = Sunday
  return addDays(d, -((dow + 6) % 7));
}

export type DateToken = "@today" | "@tomorrow" | "@yesterday" | "@this_week" | "@this_month" | "@now" | `@today${"+" | "-"}${number}d`;

/** A token as a half-open local-date range [start, end). `@now` has no range. */
export function tokenRange(token: Exclude<DateToken, "@now">, now: Date, tz: string): { start: LocalDate; end: LocalDate } {
  const today = localToday(now, tz);
  const shifted = /^@today([+-])(\d{1,4})d$/.exec(token);
  if (shifted) {
    const d = addDays(today, (shifted[1] === "-" ? -1 : 1) * Number(shifted[2]));
    return { start: d, end: addDays(d, 1) };
  }
  switch (token) {
    case "@today":
      return { start: today, end: addDays(today, 1) };
    case "@tomorrow":
      return { start: addDays(today, 1), end: addDays(today, 2) };
    case "@yesterday":
      return { start: addDays(today, -1), end: today };
    case "@this_week": {
      const start = startOfWeek(today);
      return { start, end: addDays(start, 7) };
    }
    case "@this_month": {
      const start = { year: today.year, month: today.month, day: 1 };
      const next = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
      return { start, end: next };
    }
  }
  return { start: today, end: addDays(today, 1) };
}

export const isDateToken = (v: unknown): v is DateToken =>
  typeof v === "string" && (["@today", "@tomorrow", "@yesterday", "@this_week", "@this_month", "@now"].includes(v) || /^@today[+-]\d{1,4}d$/.test(v));

/** "2026-12-01T09:30" (wall clock in `tz`, from <input type="datetime-local">) → ISO instant. */
export function localDateTimeToIso(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  // Midnight + wall-clock minutes, then re-check the offset at that instant (DST days).
  const midnight = startOfLocalDay({ year: y, month: mo, day: d }, tz);
  const guess = new Date(midnight.getTime() + (h * 60 + mi) * 60_000);
  const local = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess)
    .reduce((acc, p) => (p.type === "hour" ? acc + Number(p.value) * 60 : p.type === "minute" ? acc + Number(p.value) : acc), 0);
  const drift = local - (h * 60 + mi);
  return new Date(guess.getTime() - (((drift % 1440) + 1440 + 720) % 1440 - 720) * 60_000).toISOString();
}

/**
 * An instant as the business's wall clock, with its UTC offset: "2026-11-27 09:00 (UTC−07:00)".
 * Tools return this next to ISO times so nobody (person or AI) converts with a guessed offset.
 */
export function localLabel(iso: string, tz: string): string {
  const d = new Date(iso);
  const p = zonedParts(d, tz);
  const off = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
  const sign = off < 0 ? "−" : "+";
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)} (UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)})`;
}
