"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, CalendarCheck, CalendarPlus, Check, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Phone, User } from "lucide-react";
import type { Catalog, CatalogField, CatalogService } from "@/booking/service";
import type { WeeklyHours } from "@/schema/blueprint";
import { loadAvailability, submitBooking } from "@/app/book/[slug]/actions";
import { fmt, googleCalendarLink, icsLink, iconFor, initials, moneyFmt } from "./parts";

type Slot = { start: string; end: string; practitionerId: string };
type Step = "service" | "kind" | "who" | "when" | "details";

/** What the page shows about the business above the steps. */
export interface Shop {
  name: string;
  intro: string | null;
  address: string | null;
  phone: string | null;
  logo: string | null;
  cover: string | null;
  hours: WeeklyHours;
  /** Signed URLs of service and staff photos, by storage path. */
  photos: Record<string, string>;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * Public booking, one step per screen (phones first): service → size (for pets/vehicles with
 * variants) → who → day and time → details. A summary sits beside the steps on wide screens and
 * a sticky bar carries "Continue" on phones. In the business's theme; times in its time zone.
 */
export function BookingFlow({ slug, catalog, shop, currency = "CAD", returned }: { slug: string; catalog: Catalog; shop: Shop; currency?: string; returned?: "paid" | "cancelled" }) {
  const tz = catalog.timezone;
  const f = fmt(tz);
  const money = moneyFmt(currency);
  const kinds = catalog.for?.kinds ?? null;
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<CatalogService | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [done, setDone] = useState<{ confirmed: boolean; demo: boolean; manage?: string; end: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [booking, startBooking] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const people = service?.practitionerIds ? catalog.practitioners.filter((p) => service.practitionerIds!.includes(p.id)) : catalog.practitioners;
  const variant = service && kind ? service.variants?.[kind] : undefined;
  const duration = variant?.durationMin ?? service?.durationMin ?? 0;
  const price = variant?.price ?? service?.price ?? null;
  const nameOf = (id: string | null) => catalog.practitioners.find((p) => p.id === id)?.name ?? "";
  const steps: Step[] = ["service", ...(kinds ? (["kind"] as const) : []), ...(people.length > 1 ? (["who"] as const) : []), "when", "details"];
  const go = (s: Step) => {
    setStep(s);
    setError(null);
    setTimeout(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  const load = (svc: CatalogService, person: string | null, k: string | null) =>
    startLoading(async () => {
      const r = await loadAvailability(slug, svc.id, person, 35, k);
      if ("error" in r) return setError(r.error ?? null);
      setSlots(r.slots);
      setDay(r.slots[0] ? f.dayOf(r.slots[0].start) : null);
    });
  const toWhen = (svc: CatalogService, person: string | null, k: string | null) => {
    setSlot(null);
    setSlots(null);
    load(svc, person, k);
    go("when");
  };
  const chooseService = (s: CatalogService) => {
    setService(s);
    setWho(null);
    const people2 = s.practitionerIds ? catalog.practitioners.filter((p) => s.practitionerIds!.includes(p.id)) : catalog.practitioners;
    if (kinds) return go("kind");
    if (people2.length > 1) return go("who");
    toWhen(s, null, kind);
  };
  const chooseKind = (k: string) => {
    setKind(k);
    if (people.length > 1) return go("who");
    toWhen(service!, null, k);
  };
  const chooseWho = (p: string | null) => {
    setWho(p);
    toWhen(service!, p, kind);
  };

  const byDay = useMemo(() => {
    const m = new Map<string, Slot[]>();
    for (const s of slots ?? []) {
      const d = f.dayOf(s.start);
      m.set(d, [...(m.get(d) ?? []), s]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- f only depends on tz
  }, [slots]);

  const submit = (form: FormData) =>
    startBooking(async () => {
      setError(null);
      const pick = (prefix: string) => {
        const out: Record<string, string | boolean> = {};
        for (const [k, v] of form.entries()) if (k.startsWith(prefix) && typeof v === "string") out[k.slice(prefix.length)] = v;
        return out;
      };
      const r = await submitBooking(slug, {
        serviceId: service!.id,
        practitionerId: who,
        start: slot!.start,
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        website: String(form.get("website") ?? ""),
        kind,
        ...(catalog.for ? { forName: String(form.get("for_name") ?? ""), forValues: pick("for:") } : {}),
        clientValues: pick("client:"),
      });
      if ("error" in r) return setError(r.error ?? null);
      if (r.checkoutUrl) {
        window.location.href = r.checkoutUrl; // pay the deposit on Stripe; the booking is held meanwhile
        return;
      }
      setDone({ confirmed: r.confirmed, demo: r.demo, manage: r.manage, end: r.end });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const header = <ShopHeader shop={shop} tz={tz} />;

  if (done && slot && service) {
    const title = `${service.name} — ${catalog.business}`;
    return (
      <div className="w-full">
        {header}
        <section className="mx-auto w-full max-w-md px-4 pb-16 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white">
            <Check className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{done.confirmed ? "You’re booked in" : "Request sent"}</h1>
          <p className="mt-2 text-muted">{done.confirmed ? "See you soon." : `${catalog.business} will confirm your appointment shortly.`}</p>
          <div className="card mt-6 divide-y divide-line text-left">
            <Row label="When" value={`${f.day(f.dayOf(slot.start))} · ${f.time(slot.start)}`} />
            <Row label="What" value={`${service.name} · ${duration} min`} />
            <Row label="With" value={nameOf(slot.practitionerId)} />
            {price != null && <Row label="Price" value={money(price)} />}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a className="btn-ghost" href={icsLink(title, slot.start, done.end)} download="appointment.ics"><CalendarPlus className="h-4 w-4" /> Apple / Outlook</a>
            <a className="btn-ghost" href={googleCalendarLink(title, slot.start, done.end)} target="_blank" rel="noopener noreferrer"><CalendarPlus className="h-4 w-4" /> Google Calendar</a>
          </div>
          {done.manage && (
            <a className="mt-4 inline-block text-sm font-semibold text-accent hover:underline" href={done.manage}>Manage or cancel your booking</a>
          )}
          {done.demo && <p className="mt-6 text-sm text-muted">This is the demo salon — nothing was saved.</p>}
        </section>
      </div>
    );
  }

  const n = steps.indexOf(step) + 1;
  const back = steps[steps.indexOf(step) - 1];
  const canContinue = step === "when" && !!slot;
  return (
    <div className="w-full pb-28 lg:pb-16">
      {header}
      <div ref={top} className="mx-auto grid w-full max-w-5xl scroll-mt-4 gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {returned === "paid" && <p className="mb-4 rounded-xl bg-accent-tint px-4 py-3 text-sm text-accent">Thank you — your deposit is paid. We’ll confirm your booking in a moment.</p>}
          {returned === "cancelled" && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">The deposit wasn’t paid, so the time is only held for a little while. You can book again below.</p>}
          <div className="mb-5 flex items-center gap-3">
            {back && (
              <button type="button" onClick={() => go(back)} className="rounded-full p-2 hover:bg-card" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Step {n} of {steps.length}</p>
              <h2 className="text-2xl font-bold tracking-tight">
                {step === "service" ? "Choose a service" : step === "kind" ? `What size is your ${catalog.for?.label ?? "pet"}?` : step === "who" ? "With whom?" : step === "when" ? "Pick a time" : "Your details"}
              </h2>
            </div>
          </div>
          <div className="mb-6 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(n / steps.length) * 100}%` }} />
          </div>

          {step === "service" && <Services catalog={catalog} photos={shop.photos} money={money} selected={service?.id} onPick={chooseService} />}

          {step === "kind" && kinds && service && (
            <div className="grid gap-3 sm:grid-cols-2">
              {kinds.map((k) => {
                const v = service.variants?.[k.id];
                return (
                  <button key={k.id} type="button" onClick={() => chooseKind(k.id)} aria-pressed={kind === k.id} className={`card flex items-center justify-between gap-3 p-5 text-left transition hover:border-accent ${kind === k.id ? "border-accent ring-2 ring-accent-tint" : ""}`}>
                    <span>
                      <span className="block text-lg font-semibold">{k.label}</span>
                      <span className="flex items-center gap-1 text-sm text-muted"><Clock className="h-3.5 w-3.5" /> {v?.durationMin ?? service.durationMin} min</span>
                    </span>
                    {(v?.price ?? service.price) != null && <span className="text-lg font-semibold tabular-nums">{money((v?.price ?? service.price)!)}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {step === "who" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[{ id: null as string | null, name: "Anyone available", photo: undefined as string | undefined }, ...people].map((p) => (
                <button key={p.id ?? "any"} type="button" onClick={() => chooseWho(p.id)} aria-pressed={who === p.id} className={`card flex items-center gap-4 p-4 text-left transition hover:border-accent ${who === p.id ? "border-accent ring-2 ring-accent-tint" : ""}`}>
                  {p.photo && shop.photos[p.photo] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    <img src={shop.photos[p.photo]} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${p.id ? "bg-accent-tint text-accent" : "bg-ground text-muted"}`}>
                      {p.id ? initials(p.name) : <User className="h-6 w-6" />}
                    </span>
                  )}
                  <span>
                    <span className="block text-lg font-semibold">{p.name}</span>
                    {!p.id && <span className="text-sm text-muted">The first free time with anyone</span>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === "when" && (
            loading || !slots ? (
              <p className="flex items-center gap-2 py-8 text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Finding free times…</p>
            ) : slots.length === 0 ? (
              <div className="card p-8 text-center text-muted">No free times in the next few weeks.{people.length > 1 ? " Try someone else, or get in touch." : " Please get in touch."}</div>
            ) : (
              <div>
                <WeekStrip available={byDay} selected={day} onPick={(d) => { setDay(d); setSlot(null); }} />
                <p className="mb-3 mt-6 font-semibold">{day ? f.day(day) : ""}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {(day ? byDay.get(day) ?? [] : []).map((s) => {
                    const on = slot?.start === s.start && slot.practitionerId === s.practitionerId;
                    return (
                      <button key={s.start + s.practitionerId} type="button" aria-pressed={on} onClick={() => setSlot(s)} className={`h-12 rounded-[var(--button-radius)] border text-base font-semibold tabular-nums transition ${on ? "border-accent bg-accent text-white" : "border-line bg-card hover:border-accent hover:text-accent"}`}>
                        {f.time(s.start)}
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="btn-primary mt-6 hidden lg:inline-flex" disabled={!slot} onClick={() => go("details")}>Continue</button>
              </div>
            )
          )}

          {step === "details" && slot && (
            <form action={submit} id="booking-form" className="grid gap-4 sm:grid-cols-2">
              {catalog.for && (
                <fieldset className="card grid gap-4 p-5 sm:col-span-2 sm:grid-cols-2">
                  <legend className="sr-only">Your {catalog.for.label}</legend>
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="for_name">Your {catalog.for.label}’s name</label>
                    <input id="for_name" name="for_name" className="input" required maxLength={100} />
                    <p className="mt-1 text-xs text-muted">Been here before? Use the same name and we’ll find them.</p>
                  </div>
                  {catalog.for.ask.map((fl) => <Question key={fl.id} field={fl} name={`for:${fl.id}`} />)}
                </fieldset>
              )}
              <div className="sm:col-span-2">
                <label className="label" htmlFor="name">Your name</label>
                <input id="name" name="name" className="input" required maxLength={100} autoComplete="name" />
              </div>
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input id="email" name="email" type="email" className="input" autoComplete="email" inputMode="email" />
              </div>
              <div>
                <label className="label" htmlFor="phone">Phone</label>
                <input id="phone" name="phone" type="tel" className="input" autoComplete="tel" inputMode="tel" />
              </div>
              <p className="-mt-2 text-xs text-muted sm:col-span-2">Email or phone, so we can confirm.</p>
              {(catalog.requirements ?? []).length > 0 && (
                <div className="grid gap-4 rounded-2xl bg-ground p-4 sm:col-span-2">
                  <p className="text-sm font-semibold">Before your visit</p>
                  {catalog.requirements!.map((r) =>
                    r.field.type === "file" ? (
                      <p key={r.field.id} className="text-sm text-muted">Please bring: {r.label}</p>
                    ) : (
                      <Question key={r.field.id} field={r.field} label={r.label} name={`${r.on}:${r.field.id}`} hint={r.rule === "valid_on_date" ? `Must be on or after ${f.day(f.dayOf(slot.start), "short")}` : undefined} />
                    ),
                  )}
                </div>
              )}
              {/* Honeypot: hidden from people, bots fill it in. */}
              <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
              <button className="btn-primary hidden sm:col-span-2 lg:inline-flex" disabled={booking}>{booking ? "Booking…" : "Book appointment"}</button>
            </form>
          )}
          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>}
        </div>

        <aside className="hidden lg:block">
          <div className="card sticky top-6 p-6">
            <SummaryList service={service} duration={duration} kind={kinds?.find((k) => k.id === kind)?.label} who={slot ? nameOf(slot.practitionerId) : who ? nameOf(who) : service ? "Anyone available" : null} when={slot ? `${f.day(f.dayOf(slot.start), "short")} · ${f.time(slot.start)}` : null} />
            {price != null && service && (
              <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
                <span className="text-sm text-muted">Total</span>
                <span className="text-xl font-bold tabular-nums">{money(price)}</span>
              </div>
            )}
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><CalendarCheck className="h-3.5 w-3.5" /> Times in {tz.replace(/_/g, " ")}</p>
          </div>
        </aside>
      </div>

      {/* Phones: what's chosen so far and the next step, always in reach. */}
      {service && (step === "when" || step === "details") && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{service.name}{price != null ? ` · ${money(price)}` : ""}</p>
              <p className="truncate text-muted">{slot ? `${f.day(f.dayOf(slot.start), "short")} · ${f.time(slot.start)}` : `${duration} min`}</p>
            </div>
            {step === "when" ? (
              <button type="button" className="btn-primary px-6" disabled={!canContinue} onClick={() => go("details")}>Continue</button>
            ) : (
              <button form="booking-form" className="btn-primary px-6" disabled={booking}>{booking ? "Booking…" : "Book"}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ShopHeader({ shop, tz }: { shop: Shop; tz: string }) {
  const today = WEEKDAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(new Date()))];
  const ranges = shop.hours[today as keyof WeeklyHours];
  const hm = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined, timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h, m)));
  };
  return (
    <header className="mb-8">
      <div className="relative h-36 w-full overflow-hidden bg-accent-tint sm:h-52">
        {shop.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
          <img src={shop.cover} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{ background: "radial-gradient(circle at 20% 20%, var(--accent-tint), transparent 60%), linear-gradient(135deg, var(--accent), var(--accent-hover))", opacity: 0.9 }} />
        )}
      </div>
      <div className="relative z-10 mx-auto -mt-10 flex max-w-5xl items-end gap-4 px-4 sm:-mt-12 sm:px-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl border-4 border-[var(--ground)] bg-card text-2xl font-extrabold text-accent shadow-soft sm:h-24 sm:w-24">
          {shop.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img src={shop.logo} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(shop.name)
          )}
        </div>
        <div className="min-w-0 pb-1">
          <h1 className="truncate pt-12 text-2xl font-extrabold tracking-tight sm:text-3xl">{shop.name}</h1>
          <p className="text-sm text-muted">{ranges?.length ? `Open today ${ranges.map(([a, b]) => `${hm(a)}–${hm(b)}`).join(", ")}` : "Closed today"}</p>
        </div>
      </div>
      <div className="mx-auto mt-3 flex max-w-5xl flex-wrap gap-x-5 gap-y-1 px-4 text-sm text-muted sm:px-6">
        {shop.address && (
          <a className="inline-flex items-center gap-1.5 hover:text-ink" href={`https://maps.google.com/?q=${encodeURIComponent(shop.address)}`} target="_blank" rel="noopener noreferrer">
            <MapPin className="h-4 w-4" /> {shop.address}
          </a>
        )}
        {shop.phone && (
          <a className="inline-flex items-center gap-1.5 hover:text-ink" href={`tel:${shop.phone.replace(/[^+\d]/g, "")}`}>
            <Phone className="h-4 w-4" /> {shop.phone}
          </a>
        )}
      </div>
      {shop.intro && <p className="mx-auto mt-3 max-w-5xl px-4 text-muted sm:px-6">{shop.intro}</p>}
    </header>
  );
}

function Services({ catalog, photos, money, selected, onPick }: { catalog: Catalog; photos: Record<string, string>; money: (n: number) => string; selected?: string; onPick: (s: CatalogService) => void }) {
  if (!catalog.services.length) return <div className="card p-8 text-center text-muted">No services can be booked online right now.</div>;
  const groups = [...new Set(catalog.services.map((s) => s.category ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : 0));
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g || "other"}>
          {groups.length > 1 && <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">{g || "More"}</h3>}
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.services.filter((s) => (s.category ?? "") === g).map((s) => {
              const Icon = iconFor(s.name);
              const prices = [s.price, ...Object.values(s.variants ?? {}).map((v) => v.price)].filter((p): p is number => p != null);
              const durations = [s.durationMin, ...Object.values(s.variants ?? {}).map((v) => v.durationMin)];
              const from = prices.length ? Math.min(...prices) : null;
              const varies = new Set(prices).size > 1;
              const minD = Math.min(...durations);
              const maxD = Math.max(...durations);
              return (
                <button key={s.id} type="button" onClick={() => onPick(s)} aria-pressed={selected === s.id} className={`card flex items-center gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-accent ${selected === s.id ? "border-accent ring-2 ring-accent-tint" : ""}`}>
                  {s.photo && photos[s.photo] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
                    <img src={photos[s.photo]} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent-tint text-accent"><Icon className="h-7 w-7" /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug">{s.name}</span>
                    {s.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{s.description}</span>}
                    <span className="mt-1 flex items-center gap-1 text-sm text-muted"><Clock className="h-3.5 w-3.5" /> {minD === maxD ? `${minD} min` : `${minD}–${maxD} min`}</span>
                  </span>
                  {from != null && <span className="shrink-0 text-right font-semibold tabular-nums">{varies && <span className="block text-xs font-normal text-muted">from</span>}{money(from)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** One question from the booking setup (a pet's breed, a vaccine date, a waiver tick). */
function Question({ field, name, label, hint }: { field: CatalogField; name: string; label?: string; hint?: string }) {
  const id = `q-${name.replace(/[^a-z0-9_]/gi, "-")}`;
  const text = label ?? field.label;
  if (field.type === "checkbox")
    return (
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name={name} value="true" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
        {text}
      </label>
    );
  return (
    <div className={field.type === "long_text" ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={id}>{text}</label>
      {field.type === "long_text" ? (
        <textarea id={id} name={name} className="input" rows={3} maxLength={1000} />
      ) : field.type === "choice" || field.type === "status" ? (
        <select id={id} name={name} className="input" defaultValue="">
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input id={id} name={name} className="input" type={field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"} maxLength={300} />
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function SummaryList({ service, duration, kind, who, when }: { service: CatalogService | null; duration: number; kind?: string; who: string | null; when: string | null }) {
  const items: [string, string | null][] = [
    ["Service", service ? `${service.name} · ${duration} min` : null],
    ...(kind ? ([["Size", kind]] as [string, string][]) : []),
    ["With", who],
    ["When", when],
  ];
  return (
    <>
      <p className="text-sm font-semibold text-muted">Your appointment</p>
      <dl className="mt-4 space-y-4 text-sm">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
            <dd className={`mt-0.5 ${value ? "font-medium" : "text-muted"}`}>{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </>
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

/** A week of days at a time; days with free times can be picked. */
function WeekStrip({ available, selected, onPick }: { available: Map<string, unknown[]>; selected: string | null; onPick: (d: string) => void }) {
  const days = [...available.keys()].sort();
  const first = days[0];
  const monday = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const [week, setWeek] = useState(() => monday(selected ?? first));
  const shift = (n: number) => {
    const d = new Date(`${week}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * n);
    setWeek(d.toISOString().slice(0, 10));
  };
  const list = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${week}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const canBack = days.some((d) => d < week);
  const canNext = days.some((d) => d > list[6]);
  const label = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${list[3]}T12:00:00Z`));
  return (
    <div>
      <div className="mb-2 flex items-center">
        <span className="flex-1 font-semibold">{label}</span>
        <button type="button" className="rounded-full p-2 hover:bg-card disabled:opacity-30" disabled={!canBack} onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft className="h-5 w-5" /></button>
        <button type="button" className="rounded-full p-2 hover:bg-card disabled:opacity-30" disabled={!canNext} onClick={() => shift(1)} aria-label="Next week"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {list.map((d) => {
          const open = available.has(d);
          const on = d === selected;
          const date = new Date(`${d}T12:00:00Z`);
          return (
            <button key={d} type="button" disabled={!open} onClick={() => onPick(d)} aria-pressed={on} aria-label={open ? `${d}, free times` : `${d}, no free times`} className={`flex flex-col items-center rounded-2xl border py-2.5 transition ${on ? "border-accent bg-accent text-white" : open ? "border-line bg-card hover:border-accent" : "border-transparent text-muted/50"}`}>
              <span className="text-[11px] font-semibold uppercase">{new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date)}</span>
              <span className="text-lg font-bold tabular-nums">{date.getUTCDate()}</span>
              {open && !on && <span className="mt-0.5 h-1 w-1 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
