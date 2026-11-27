import { Bath, Brush, Car, Dog, Dumbbell, Flower2, Hand, Hammer, HeartPulse, Home, Scissors, Sparkles, SprayCan, Stethoscope, Wrench, type LucideIcon } from "lucide-react";

/** A fitting starter icon from a service's name, until the owner adds a photo. */
const ICONS: [RegExp, LucideIcon][] = [
  [/cut|trim|fade|hair|barber|fringe|beard/i, Scissors],
  [/bath|wash|shampoo|rinse/i, Bath],
  [/dog|cat|pet|groom|puppy|paw/i, Dog],
  [/nail|mani|pedi|gel/i, Hand],
  [/colou?r|balayage|highlight|tint|dye|blow|style/i, Brush],
  [/clean|maid|tidy|vacuum/i, SprayCan],
  [/massage|spa|facial|relax|wax|brow|lash/i, Flower2],
  [/oil|brake|tire|tyre|repair|engine|service|inspect|mechanic|tune/i, Wrench],
  [/detail|car|vehicle/i, Car],
  [/build|install|carpent|deck|fence|reno/i, Hammer],
  [/garden|lawn|landscap|yard|plant|hedge/i, Flower2],
  [/train|class|fitness|yoga|pilates|gym|session/i, Dumbbell],
  [/physio|therapy|consult|clinic|check/i, Stethoscope],
  [/health|care|wellness/i, HeartPulse],
  [/home|house|move/i, Home],
];
export const iconFor = (name: string): LucideIcon => matchIcon(name) ?? Sparkles;
/** The fitting icon, or nothing when the name says nothing (a person's name). */
export const matchIcon = (name: string): LucideIcon | undefined => ICONS.find(([re]) => re.test(name))?.[1];

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function fmt(tz: string) {
  return {
    dayOf: (iso: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso)),
    time: (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso)),
    day: (d: string, style: "long" | "short" = "long") =>
      new Intl.DateTimeFormat(undefined, style === "long" ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)),
  };
}

export const moneyFmt = (currency: string) => (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);

/** A calendar file for the appointment (works with Apple, Google and Outlook calendars). */
export function icsLink(title: string, start: string, end: string, url?: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//One App//Booking//EN", "BEGIN:VEVENT", `UID:${f(start)}@one-app`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${title.replace(/[,;]/g, " ")}`, ...(url ? [`URL:${url}`] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

/** Google Calendar's "add event" link (opens in the browser, no file needed). */
export function googleCalendarLink(title: string, start: string, end: string, details?: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${f(start)}/${f(end)}`, ...(details ? { details } : {}) });
  return `https://calendar.google.com/calendar/render?${q}`;
}
