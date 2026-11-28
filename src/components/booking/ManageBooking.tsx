"use client";

import { useState, useTransition } from "react";
import { CalendarPlus, CalendarX, Check } from "lucide-react";
import type { ManagedBooking } from "@/server/bookingLinks";
import { fmt, googleCalendarLink, icsLink } from "./parts";

/** The client's own booking: when, what, with whom; add to calendar; cancel until the window. */
export function ManageBooking({ booking: b, bookAgain, cancel }: { booking: ManagedBooking; bookAgain: string | null; cancel: () => Promise<{ ok: boolean; message?: string }> }) {
  const f = fmt(b.timezone);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cancelled = b.state === "cancelled";
  const title = `${b.service} — ${b.business}`;
  return (
    <section className="w-full max-w-md">
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">{b.business}</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{cancelled ? "Booking cancelled" : "Your booking"}</h1>
      <div className="card mt-6 divide-y divide-line">
        <Row label="When" value={`${f.day(f.dayOf(b.start))} · ${f.time(b.start)}`} strike={cancelled} />
        <Row label="What" value={b.service} strike={cancelled} />
        {b.for && <Row label="For" value={b.for} strike={cancelled} />}
        {b.with && <Row label="With" value={b.with} strike={cancelled} />}
        <Row label="Status" value={cancelled ? "Cancelled" : b.state === "requested" ? "Waiting for confirmation" : b.state === "held" ? "Held — deposit not paid yet" : "Confirmed"} />
      </div>
      {!cancelled && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a className="btn-ghost" href={icsLink(title, b.start, b.end)} download="appointment.ics"><CalendarPlus className="h-4 w-4" /> Apple / Outlook</a>
          <a className="btn-ghost" href={googleCalendarLink(title, b.start, b.end)} target="_blank" rel="noopener noreferrer"><CalendarPlus className="h-4 w-4" /> Google Calendar</a>
        </div>
      )}
      {!cancelled && b.canCancel && (
        <div className="mt-6">
          {!asking ? (
            <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:underline" onClick={() => setAsking(true)}>
              <CalendarX className="h-4 w-4" /> Cancel this booking
            </button>
          ) : (
            <div className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">
              <p>Cancel your {b.service.toLowerCase()} on {f.day(f.dayOf(b.start), "short")}?</p>
              <div className="mt-3 flex gap-2">
                <button type="button" className="btn bg-red-700 px-4 py-2 text-white" disabled={pending} onClick={() => start(async () => { const r = await cancel(); if (!r.ok) setError(r.message ?? "Couldn’t cancel"); })}>
                  {pending ? "Cancelling…" : "Yes, cancel"}
                </button>
                <button type="button" className="btn-ghost px-4 py-2" onClick={() => setAsking(false)}>Keep it</button>
              </div>
            </div>
          )}
        </div>
      )}
      {!cancelled && !b.canCancel && b.state !== "completed" && <p className="mt-6 text-sm text-muted">Cancelling online closes {b.cancelWindowHours} hours before the start — please get in touch with {b.business} to change it.</p>}
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {cancelled && bookAgain && (
        <a className="btn-primary mt-6" href={bookAgain}><Check className="h-4 w-4" /> Book another time</a>
      )}
    </section>
  );
}

function Row({ label, value, strike }: { label: string; value: string; strike?: boolean }) {
  return (
    <div className="flex justify-between gap-4 px-5 py-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={`text-right font-medium ${strike ? "line-through opacity-60" : ""}`}>{value}</span>
    </div>
  );
}
