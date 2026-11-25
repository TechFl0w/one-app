"use server";

import { availableSlots, bookSlot, catalog, daysWithSlots } from "@/booking/service";
import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { RecordError } from "@/engine/records";
import { publicBooking } from "@/server/bookingPage";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckout, getAccount, stripeConfigured } from "@/server/payments";
import { depositAmount, MIN_CHECKOUT_MINUTES } from "@/payments/core";
import type { Blueprint } from "@/schema/blueprint";

/** Currency of the services' price field (money fields carry one), else CAD. */
function currencyOf(bp: Blueprint): string {
  const sc = bp.scheduling!;
  const f = sc.services.price ? bp.tables.find((t) => t.id === sc.services.table)?.fields.find((x) => x.id === sc.services.price) : undefined;
  return (f?.type === "money" && f.currency) || process.env.DEFAULT_CURRENCY || "CAD";
}

/** Public booking actions. "demo" is the sample salon in memory (nothing is saved). */

async function resolve(slug: string) {
  if (slug === "demo") return { blueprint: demoBlueprint, backend: memoryBackend({ blueprint: demoBlueprint, records: demoRecords() }).backend, demo: true };
  const r = await publicBooking(slug);
  return r ? { ...r, demo: false } : null;
}

const fail = (e: unknown) => ({ error: e instanceof RecordError ? e.message : "Something went wrong. Please try again." });

export async function loadCatalog(slug: string) {
  const r = await resolve(slug);
  return r ? catalog(r.blueprint, r.backend) : null;
}

export async function loadDays(slug: string, serviceId: string, practitionerId: string | null) {
  try {
    const r = await resolve(slug);
    if (!r) return fail(new RecordError("not_found", "Not found"));
    return { days: await daysWithSlots(r.blueprint, r.backend, { serviceId, practitionerId: practitionerId ?? undefined, days: 14 }) };
  } catch (e) {
    return fail(e);
  }
}

/** Every free time for a service over the next `days` days (one call powers the whole calendar). */
export async function loadAvailability(slug: string, serviceId: string, practitionerId: string | null, days = 35) {
  try {
    const r = await resolve(slug);
    if (!r) return fail(new RecordError("not_found", "Not found"));
    const slots = await availableSlots(r.blueprint, r.backend, { serviceId, practitionerId: practitionerId ?? undefined, days: Math.min(Math.max(days, 1), 60) });
    return { slots: slots.map((s) => ({ start: s.start, end: s.end, practitionerId: s.practitionerId })) };
  } catch (e) {
    return fail(e);
  }
}

export async function loadSlots(slug: string, serviceId: string, practitionerId: string | null, date: string) {
  try {
    const r = await resolve(slug);
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(new RecordError("not_found", "Not found"));
    const [y, m, d] = date.split("-").map(Number);
    const slots = await availableSlots(r.blueprint, r.backend, { serviceId, practitionerId: practitionerId ?? undefined, from: { year: y, month: m, day: d }, days: 1 });
    return { slots };
  } catch (e) {
    return fail(e);
  }
}

export async function submitBooking(
  slug: string,
  req: { serviceId: string; practitionerId: string | null; start: string; name: string; email: string; phone: string; website?: string },
) {
  if (req.website) return { error: "Something went wrong. Please try again." }; // honeypot: bots fill hidden fields
  try {
    const r = await resolve(slug);
    if (!r) return fail(new RecordError("not_found", "Not found"));
    const sc = r.blueprint.scheduling!;
    const services = await catalog(r.blueprint, r.backend);
    const service = services.services.find((s) => s.id === req.serviceId);
    // Deposit: only for real businesses with Stripe ready and a deposit rule that yields an amount.
    const deposit = !r.demo && sc.deposit && service ? depositAmount(service.price, sc.deposit) : null;
    const account = deposit && "page" in r ? await getAccount(createAdminClient("public"), r.page.businessId) : null;
    const takeDeposit = !!(deposit && account?.chargesEnabled && stripeConfigured());
    const holdMinutes = Math.max(sc.rules.holdMin, MIN_CHECKOUT_MINUTES) + 1;
    const now = new Date();

    const booked = await bookSlot(
      r.blueprint,
      r.backend,
      {
        serviceId: req.serviceId,
        practitionerId: req.practitionerId ?? undefined,
        start: req.start,
        client: { name: req.name.slice(0, 100), email: req.email.trim() || undefined, phone: req.phone.trim() || undefined },
      },
      now,
      takeDeposit ? { holdUntil: new Date(now.getTime() + holdMinutes * 60_000) } : {},
    );
    let checkoutUrl: string | undefined;
    if (takeDeposit && "page" in r && booked.state === "held") {
      const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
      const checkout = await createCheckout(createAdminClient("public"), {
        businessId: r.page.businessId,
        tableId: sc.bookings.table,
        recordId: booked.bookingId,
        kind: "deposit",
        amount: deposit!,
        currency: currencyOf(r.blueprint),
        description: `Deposit: ${service!.name} — ${r.blueprint.business.name}`,
        successUrl: `${origin}/book/${slug}?paid=1`,
        cancelUrl: `${origin}/book/${slug}?cancelled=1`,
        expiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        customerEmail: req.email.trim() || undefined,
      });
      checkoutUrl = checkout.url;
    }
    return { ok: true as const, start: booked.slot.start, practitionerId: booked.slot.practitionerId, confirmed: booked.state === "confirmed", demo: r.demo, checkoutUrl };
  } catch (e) {
    return fail(e);
  }
}
