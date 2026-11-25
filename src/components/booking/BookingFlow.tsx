"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, CalendarCheck, Clock } from "lucide-react";
import type { Catalog, CatalogService } from "@/booking/service";
import type { Slot } from "@/booking/slots";
import { loadDays, loadSlots, submitBooking } from "@/app/book/[slug]/actions";

type Step = "service" | "who" | "day" | "time" | "details" | "done";

/** Public booking: service → who → day → time → details → done. Times shown in the business's timezone. */
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
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<CatalogService | null>(null);
  const [who, setWho] = useState<string | null>(null);
  const [days, setDays] = useState<{ date: string; slots: number }[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [done, setDone] = useState<{ confirmed: boolean; demo: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const tz = catalog.timezone;

  const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const fmtDay = (d: string, long = false) =>
    new Intl.DateTimeFormat("en-CA", { weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  const nameOf = (id: string) => catalog.practitioners.find((p) => p.id === id)?.name ?? "";
  const people = service?.practitionerIds ? catalog.practitioners.filter((p) => service.practitionerIds!.includes(p.id)) : catalog.practitioners;

  useEffect(() => {
    if (step !== "day" || !service) return;
    start(async () => {
      const r = await loadDays(slug, service.id, who);
      if ("error" in r) setError(r.error ?? null);
      else setDays(r.days);
    });
  }, [step, service, who, slug]);

  const pickDay = (d: string) => {
    setDay(d);
    setError(null);
    start(async () => {
      const r = await loadSlots(slug, service!.id, who, d);
      if ("error" in r) return setError(r.error ?? null);
      setSlots(r.slots);
      setStep("time");
    });
  };

  const submit = (form: FormData) =>
    start(async () => {
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
      setStep("done");
    });

  const back: Partial<Record<Step, Step>> = { who: "service", day: people.length > 1 ? "who" : "service", time: "day", details: "time" };

  return (
    <div className="card w-full max-w-lg p-6 sm:p-8">
      <header className="mb-6">
        <p className="text-sm font-semibold text-accent">{catalog.business}</p>
        <div className="mt-1 flex items-center gap-2">
          {back[step] && (
            <button type="button" className="-ml-1.5 rounded-full p-1.5 hover:bg-ground" onClick={() => setStep(back[step]!)} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h1 className="text-xl font-bold">
            {{ service: "Book an appointment", who: "With whom?", day: "Pick a day", time: day ? fmtDay(day, true) : "", details: "Your details", done: "You’re booked in" }[step]}
          </h1>
        </div>
        {step === "service" && intro && <p className="mt-2 text-sm text-muted">{intro}</p>}
        {service && step !== "service" && step !== "done" && (
          <p className="mt-2 text-sm text-muted">
            {service.name} · {service.durationMin} min{who ? ` · ${nameOf(who)}` : ""}
            {slot && step === "details" ? ` · ${fmtDay(day!)} ${fmtTime(slot.start)}` : ""}
          </p>
        )}
      </header>

      {step === "service" && returned === "paid" && (
        <p className="mb-4 rounded-xl bg-accent-tint px-3 py-2 text-sm text-accent">Thank you — your deposit is paid. We’ll confirm your booking in a moment.</p>
      )}
      {step === "service" && returned === "cancelled" && (
        <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">The deposit wasn’t paid, so the time is only held for a little while. You can book again below.</p>
      )}
      {step === "service" && (
        <ul className="space-y-2">
          {catalog.services.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left hover:border-accent hover:bg-accent-tint"
                onClick={() => {
                  setService(s);
                  setWho(null);
                  const ppl = s.practitionerIds ? catalog.practitioners.filter((p) => s.practitionerIds!.includes(p.id)) : catalog.practitioners;
                  setStep(ppl.length > 1 ? "who" : "day");
                }}
              >
                <span className="flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" /> {s.durationMin} min</span>
                </span>
                {s.price != null && <span className="text-sm font-semibold">{money(s.price)}</span>}
              </button>
            </li>
          ))}
          {catalog.services.length === 0 && <p className="text-sm text-muted">No services can be booked online right now.</p>}
        </ul>
      )}

      {step === "who" && (
        <ul className="space-y-2">
          {[{ id: null as string | null, name: "Anyone available" }, ...people].map((p) => (
            <li key={p.id ?? "any"}>
              <button type="button" className="w-full rounded-2xl border border-line px-4 py-3 text-left font-medium hover:border-accent hover:bg-accent-tint" onClick={() => { setWho(p.id); setStep("day"); }}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === "day" && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              disabled={d.slots === 0 || busy}
              onClick={() => pickDay(d.date)}
              className="rounded-2xl border border-line px-2 py-3 text-center text-sm hover:border-accent hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-transparent"
            >
              <span className="block font-medium">{fmtDay(d.date)}</span>
              <span className="text-xs text-muted">{d.slots ? `${d.slots} times` : "Full"}</span>
            </button>
          ))}
          {busy && days.length === 0 && <p className="col-span-full text-sm text-muted">Finding free times…</p>}
        </div>
      )}

      {step === "time" && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <button key={s.start} type="button" className="whitespace-nowrap rounded-full border border-line px-2 py-2 text-sm font-medium hover:border-accent hover:bg-accent-tint" onClick={() => { setSlot(s); setStep("details"); }}>
              {fmtTime(s.start)}
            </button>
          ))}
          {slots.length === 0 && <p className="col-span-full text-sm text-muted">That day just filled up. Pick another day.</p>}
        </div>
      )}

      {step === "details" && (
        <form action={submit} className="space-y-4">
          <div>
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
            <p className="mt-1 text-xs text-muted">Email or phone, so we can confirm.</p>
          </div>
          {/* Honeypot: hidden from people, bots fill it in. */}
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Booking…" : "Book"}</button>
        </form>
      )}

      {step === "done" && slot && (
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-base font-semibold text-accent"><CalendarCheck className="h-5 w-5" /> {fmtDay(day!, true)} at {fmtTime(slot.start)}</p>
          <p>{service!.name} with {nameOf(slot.practitionerId)}.</p>
          <p className="text-muted">{done?.confirmed ? "Your appointment is confirmed." : "We’ve got your request and will confirm it shortly."}</p>
          {done?.demo && <p className="rounded-xl bg-accent-tint px-3 py-2 text-accent">This is the demo salon — nothing was saved.</p>}
        </div>
      )}

      {error && <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
    </div>
  );
}
