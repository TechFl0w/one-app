"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CalendarCheck, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Loader2, User } from "lucide-react";
import type { Catalog, CatalogService } from "@/booking/service";
import { loadAvailability, submitBooking } from "@/app/book/[slug]/actions";

type Slot = { start: string; end: string; practitionerId: string };

/**
 * Public booking on one screen: service, who, day (month calendar), time (grouped by part of the
 * day) and details, with a live summary. Uses the business's theme (CSS variables on the page).
 * Times are shown in the business's timezone.
 */
export function BookingFlow({
  slug,
  catalog,
  currency = "CAD",
  intro,
  returned,
}: {
  slug: string;
  catalog: Catalog;
  currency?: string;
  intro?: string | null;
  /** Back from Stripe Checkout. */
  returned?: "paid" | "cancelled";
}) {
  const tz = catalog.timezone;
  const [service, setService] = useState<CatalogService | null>(catalog.services.length === 1 ? catalog.services[0] : null);
  const [who, setWho] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [month, setMonth] = useState<string | null>(null); // YYYY-MM shown in the calendar
  const [done, setDone] = useState<{ confirmed: boolean; demo: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [booking, startBooking] = useTransition();
  const detailsRef = useRef<HTMLDivElement>(null);

  const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(new Date(iso));
  const fmtTime = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const fmtDay = (d: string, style: "long" | "short" = "long") =>
    new Intl.DateTimeFormat(undefined, style === "long" ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const money = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  const nameOf = (id: string) => catalog.practitioners.find((p) => p.id === id)?.name ?? "";
  const people = service?.practitionerIds ? catalog.practitioners.filter((p) => service.practitionerIds!.includes(p.id)) : catalog.practitioners;

  // Free times for the chosen service/person: one request covers the whole calendar.
  const load = (svc: CatalogService, person: string | null) =>
    startLoading(async () => {
      const r = await loadAvailability(slug, svc.id, person);
      if ("error" in r) return setError(r.error ?? null);
      setError(null);
      setSlots(r.slots);
      const first = r.slots[0] ? dayOf(r.slots[0].start) : null;
      setDay(first);
      setMonth(first ? first.slice(0, 7) : null);
    });
  const chooseService = (svc: CatalogService) => {
    setService(svc);
    setWho(null);
    setSlot(null);
    setSlots(null);
    load(svc, null);
  };
  const chooseWho = (person: string | null) => {
    setWho(person);
    setSlot(null);
    setSlots(null);
    if (service) load(service, person);
  };
  // A business with a single service starts on it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !service) return;
    started.current = true;
    load(service, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) (m.get(dayOf(s.start)) ?? m.set(dayOf(s.start), []).get(dayOf(s.start))!).push(s);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dayOf only depends on tz
  }, [slots]);
  const parts = useMemo(() => {
    const daySlots = day ? (byDay.get(day) ?? []) : [];
    const hour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso)));
    const groups: [string, Slot[]][] = [["Morning", []], ["Afternoon", []], ["Evening", []]];
    for (const s of daySlots) groups[hour(s.start) < 12 ? 0 : hour(s.start) < 17 ? 1 : 2][1].push(s);
    return groups.filter(([, list]) => list.length);
  }, [byDay, day, tz]);

  const pickSlot = (s: Slot) => {
    setSlot(s);
    setTimeout(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  const submit = (form: FormData) =>
    startBooking(async () => {
      setError(null);
      const r = await submitBooking(slug, {
        serviceId: service!.id,
        practitionerId: who,
        start: slot!.start,
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        website: String(form.get("website") ?? ""),
      });
      if ("error" in r) return setError(r.error ?? null);
      if (r.checkoutUrl) {
        window.location.href = r.checkoutUrl; // pay the deposit on Stripe; the booking is held meanwhile
        return;
      }
      setDone({ confirmed: r.confirmed, demo: r.demo });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  if (done && slot && service) {
    const ics = icsLink(`${service.name} — ${catalog.business}`, slot.start, slot.end);
    return (
      <section className="mx-auto w-full max-w-xl text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white">
          <Check className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{done.confirmed ? "You’re booked in" : "Request sent"}</h1>
        <p className="mt-2 text-muted">{done.confirmed ? "See you soon." : `${catalog.business} will confirm your appointment shortly.`}</p>
        <div className="card mt-8 divide-y divide-line text-left">
          <Row label="When" value={`${fmtDay(dayOf(slot.start))} · ${fmtTime(slot.start)}`} />
          <Row label="What" value={`${service.name} · ${service.durationMin} min`} />
          <Row label="With" value={nameOf(slot.practitionerId)} />
          {service.price != null && <Row label="Price" value={money(service.price)} />}
        </div>
        <a className="btn-ghost mt-6" href={ics} download="appointment.ics">
          <CalendarPlus className="h-4 w-4" /> Add to calendar
        </a>
        {done.demo && <p className="mt-6 text-sm text-muted">This is the demo salon — nothing was saved.</p>}
      </section>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-12">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">{catalog.business}</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Book an appointment</h1>
          {intro && <p className="mt-3 max-w-xl text-lg text-muted">{intro}</p>}
          {returned === "paid" && <p className="mt-4 rounded-xl bg-accent-tint px-4 py-3 text-sm text-accent">Thank you — your deposit is paid. We’ll confirm your booking in a moment.</p>}
          {returned === "cancelled" && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The deposit wasn’t paid, so the time is only held for a little while. You can book again below.</p>}
        </header>

        <Section n={1} title="Choose a service">
          {catalog.services.length === 0 ? (
            <p className="text-muted">No services can be booked online right now.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {catalog.services.map((s) => {
                const on = service?.id === s.id;
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => chooseService(s)} aria-pressed={on} className="group flex w-full items-center gap-4 py-4 text-left">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-white" : "border-line group-hover:border-accent"}`}>
                        {on && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-lg ${on ? "font-semibold" : "font-medium"}`}>{s.name}</span>
                        <span className="flex items-center gap-1 text-sm text-muted"><Clock className="h-3.5 w-3.5" /> {s.durationMin} min</span>
                      </span>
                      {s.price != null && <span className="text-lg font-semibold tabular-nums">{money(s.price)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {service && people.length > 1 && (
          <Section n={2} title="With whom?">
            <div className="flex flex-wrap gap-3">
              {[{ id: null as string | null, name: "Anyone available" }, ...people].map((p) => {
                const on = who === p.id;
                return (
                  <button key={p.id ?? "any"} type="button" aria-pressed={on} onClick={() => chooseWho(p.id)} className={`flex items-center gap-3 rounded-full border py-2 pl-2 pr-5 transition ${on ? "border-accent bg-accent-tint" : "border-line hover:border-accent"}`}>
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${on ? "bg-accent text-white" : "bg-ground text-muted"}`}>
                      {p.id ? initials(p.name) : <User className="h-4 w-4" />}
                    </span>
                    <span className="font-medium">{p.name}</span>
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {service && (
          <Section n={people.length > 1 ? 3 : 2} title="Pick a day and time">
            {loading || !slots ? (
              <p className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Finding free times…</p>
            ) : slots.length === 0 ? (
              <p className="text-muted">No free times in the next few weeks. Try someone else, or get in touch.</p>
            ) : (
              <div className="grid gap-8 md:grid-cols-[320px_minmax(0,1fr)]">
                <MonthCalendar month={month!} setMonth={setMonth} available={byDay} selected={day} onPick={(d) => { setDay(d); setSlot(null); }} />
                <div className="min-w-0">
                  <h3 className="mb-4 font-semibold">{day ? fmtDay(day) : "Pick a day"}</h3>
                  {parts.map(([label, list]) => (
                    <div key={label} className="mb-5">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {list.map((s) => {
                          const on = slot?.start === s.start && slot.practitionerId === s.practitionerId;
                          return (
                            <button key={s.start + s.practitionerId} type="button" aria-pressed={on} onClick={() => pickSlot(s)} className={`rounded-[var(--button-radius)] border py-2 text-sm font-medium tabular-nums transition ${on ? "border-accent bg-accent text-white" : "border-line hover:border-accent hover:text-accent"}`}>
                              {fmtTime(s.start)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {slot && (
          <div ref={detailsRef}>
            <Section n={people.length > 1 ? 4 : 3} title="Your details">
              <form action={submit} id="booking-form" className="grid max-w-xl gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="name">Name</label>
                  <input id="name" name="name" className="input" required maxLength={100} autoComplete="name" />
                </div>
                <div>
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" className="input" autoComplete="email" />
                </div>
                <div>
                  <label className="label" htmlFor="phone">Phone</label>
                  <input id="phone" name="phone" type="tel" className="input" autoComplete="tel" />
                </div>
                <p className="text-xs text-muted sm:col-span-2">Email or phone, so we can confirm.</p>
                {/* Honeypot: hidden from people, bots fill it in. */}
                <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
                <button className="btn-primary sm:col-span-2 lg:hidden" disabled={booking}>{booking ? "Booking…" : "Book appointment"}</button>
              </form>
            </Section>
          </div>
        )}
        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
      </div>

      {/* Summary: sticky beside the steps on wide screens. */}
      <aside className="hidden lg:block">
        <div className="card sticky top-8 p-6">
          <p className="text-sm font-semibold text-muted">Your appointment</p>
          <dl className="mt-4 space-y-4 text-sm">
            <Summary label="Service" value={service ? `${service.name} · ${service.durationMin} min` : null} />
            <Summary label="With" value={slot ? nameOf(slot.practitionerId) : who ? nameOf(who) : service ? "Anyone available" : null} />
            <Summary label="When" value={slot ? `${fmtDay(dayOf(slot.start), "short")} · ${fmtTime(slot.start)}` : null} />
          </dl>
          {service?.price != null && (
            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-sm text-muted">Total</span>
              <span className="text-xl font-bold tabular-nums">{money(service.price)}</span>
            </div>
          )}
          <button form="booking-form" className="btn-primary mt-6 w-full" disabled={!slot || booking}>
            {booking ? "Booking…" : slot ? "Book appointment" : "Pick a time"}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted"><CalendarCheck className="h-3.5 w-3.5" /> Times in {tz.replace(/_/g, " ")}</p>
        </div>
      </aside>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 flex items-center gap-3 text-xl font-semibold tracking-tight">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`mt-0.5 ${value ? "font-medium" : "text-muted"}`}>{value ?? "—"}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Month grid; days with free times are bold and clickable. */
function MonthCalendar({ month, setMonth, available, selected, onPick }: { month: string; setMonth: (m: string) => void; available: Map<string, unknown[]>; selected: string | null; onPick: (d: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // weeks start Monday
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const months = [...available.keys()].map((d) => d.slice(0, 7));
  const canBack = months.some((x) => x < month);
  const canNext = months.some((x) => x > month);
  return (
    <div>
      <div className="mb-3 flex items-center">
        <button type="button" className="rounded-full p-2 hover:bg-ground disabled:opacity-30" disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
        <span className="flex-1 text-center font-semibold">{new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</span>
        <button type="button" className="rounded-full p-2 hover:bg-ground disabled:opacity-30" disabled={!canNext} onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs text-muted">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const d = iso(i + 1);
          const open = available.has(d);
          const on = d === selected;
          return (
            <button
              key={d}
              type="button"
              disabled={!open}
              onClick={() => onPick(d)}
              aria-pressed={on}
              aria-label={open ? `${d}, free times` : `${d}, no free times`}
              className={`relative aspect-square rounded-full text-sm tabular-nums transition ${on ? "bg-accent font-semibold text-white" : open ? "font-semibold hover:bg-accent-tint" : "text-muted/50"}`}
            >
              {i + 1}
              {open && !on && <span className="absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A calendar file for the appointment (works with Apple, Google and Outlook calendars). */
function icsLink(title: string, start: string, end: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//One App//Booking//EN", "BEGIN:VEVENT", `UID:${f(start)}@one-app`, `DTSTAMP:${f(new Date().toISOString())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:${title.replace(/[,;]/g, " ")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}
