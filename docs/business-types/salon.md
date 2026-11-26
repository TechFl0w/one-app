# Salons: analysis

Hair salons, barbers, nail salons, lash & brow studios, beauty and day spas run on the same core:
**clients book services with a team member, at a time, sometimes in a chair or room.** The
differences are in the details: colour formulas, processing time, walk-ins, patch tests, add-ons,
packages. So this is **one salon foundation with a variant per type**, not five separate apps. The
owner picks the type at sign-up; the variant switches on its extra tables, screens and rules. As
with the mechanic shop (`mechanic.md`), the owner can then redesign any screen without touching
the data or the rules underneath.

## A day in the salon

1. **Booking.** The client books online or the front desk books them: one or more services, with a
   chosen stylist or "anyone", at a free time. A deposit may be taken for long or new-client
   bookings.
2. **Reminder.** A message the day before. Cancelling inside the cancellation window may cost a fee.
3. **Arrival.** The booking is checked in (or recorded as a no-show). Walk-ins are added on the
   spot (barbers, nails).
4. **Service.** The stylist sees the client's history: last colour formula, allergies or notes,
   before/after photos. Colour has a **processing gap**: the stylist is free while it develops and
   can take another client.
5. **Checkout.** The services done, plus any products sold and a tip, minus deposit, package
   credit or gift card. The client pays and the visit is closed. Totals and balances are computed,
   never typed (`data-rules.md`).
6. **Follow-up.** A review request a few hours later. A rebooking nudge when the usual interval has
   passed (a haircut after 6 weeks, nail infills after 3), sent only if they haven't already
   booked.
7. **End of day / week.** Takings per stylist, commission, product stock to reorder, quiet slots
   to fill.

## Core (every variant)

| Table | Key fields (facts) | Computed |
|---|---|---|
| **Clients** | name, phone/WhatsApp, email, birthday, notes, allergies, marketing consent | visits, last visit, next booking, total spent, no-shows, status: *New / Regular / Lapsed* (follows last visit) |
| **Team** | name, role/level (junior, senior, master), working hours, bookable online, commission % | today's bookings, takings this month |
| **Services** | name, category, duration, price, processing gap (min), cleanup (min), deposit, bookable online, who can do it, rebook after (weeks) | bookings this month |
| **Bookings** | client, service(s), team member, start, end, status (decided: requested / booked / checked in / done / no-show / cancelled), station, source (online / phone / walk-in), notes | visit total, paid, balance, payment: *Paid / Part paid / Unpaid*, timing: *Upcoming / Today / Past* |
| **Visit lines** | booking, kind (service / add-on / product / tip / discount), item, qty, price | line total (formula) |
| **Payments** | booking, amount, method, paid on, kind (deposit / payment / refund) | (settled history: never deleted) |
| **Products** (retail) | name, brand, price, cost, stock count, reorder at | sold (rollup of lines), in stock (formula), stock: *Out / Low / OK* |
| **Time off** | team member, from, to, reason | (blocks booking) |

Screens: **Today** (bookings by team member, arrivals, money in), **Calendar** (day/week by team
member), **Bookings board** (drag through Booked → Checked in → Done), **Clients** (and a client
page with history, notes and photos), **Services**, **Team**, **Products**, **Takings** (by day and
by team member), **Booking page** (public).

Automations (re-checked before sending): appointment reminder the day before (still booked);
review request 3 hours after Done (still done); rebooking nudge after the service's interval
(no upcoming booking: the existing `no_upcoming_booking` guard); birthday message (marketing
consent); low-stock notice.

## Variants

| | Hair salon | Barber | Nail salon | Lash & brow / beauty | Spa / massage |
|---|---|---|---|---|---|
| Booking style | Appointments | Appointments + **walk-in queue** | Appointments + walk-ins | Appointments | Appointments, **rooms** |
| Processing gap | **Yes** (colour) | No | Yes (gel/acrylic curing, short) | Yes (tint) | No |
| Client record extras | **Colour formulas** (date, formula, developer, result photo) | Usual cut/fade notes | Shape, length, colour used | **Patch test date** (required before tint/lashes), lash map | Health form, pressure preference |
| Required before booking | Patch test for colour (48h) | – | – | **Patch test** for tint/lash | Consent / health form |
| Stations | Chairs, basins | Chairs | **Tables, pedicure chairs** | Beds | **Rooms** |
| Pricing | **By stylist level** (junior/senior) | Flat | Flat + add-ons (nail art, removal) | Flat + infill vs full set | By duration (60/90 min) |
| Rebook interval | 6–8 weeks | **2–4 weeks** | 2–3 weeks (infill) | 2–3 weeks (infill) | 4 weeks |
| Extras | Retail, packages | Memberships (unlimited cuts) | Retail | Courses (packages) | Packages, gift vouchers, couples bookings |

## What the platform needs (in order)

1. **Visit checkout**: visit lines on a booking (services, add-ons, products, tip, discount),
   computed total, payments, balance. *(Formulas and record pages, built for the mechanic shop,
   carry this.)*
2. **Processing gaps in the slot finder**: a service = active time + gap + finish time; the team
   member is bookable during the gap. *(Booking engine, `src/booking/slots.ts`.)*
3. **Multi-service bookings and add-ons**: one visit with several services, back to back, each
   possibly with a different team member; add-ons extend time and price.
4. **Price by team-member level**: a service price per level; the booking takes the price of whoever
   does it.
5. **Walk-in queue** (barbers, nails): a "waiting" list ordered by arrival, assigned to the next
   free team member, without a fixed time.
6. **Requirements before booking**: a service can require a patch test within N days or a signed
   form; online booking says so and the desk sees a warning.
7. **Packages, memberships, gift cards**: prepaid credit with a balance (sold, used, remaining:
   computed), applied at checkout.
8. **Commission and takings per team member**: rollups over visit lines by who did the service.
9. **Client photos and formula history**: child records with a photo (file uploads exist).

Items 1, 8 and 9 need no new platform features. Items 2–4 extend the booking engine. Items 5–7
are new building blocks that other business types also use: queues (restaurants, clinics),
requirements (rentals, gyms), credit (gyms, studios).

## Build plan

1. **Salon core template**: tables, screens, record pages, checkout with lines and payments,
   automations, sample data. Variant chosen at sign-up: hair / barber / nails / lash & beauty /
   spa. Demo: `/demo?type=hair_salon` and so on.
2. **Booking engine**: processing gaps, multi-service visits, add-ons, price by level.
3. **Variant extras**: colour formulas and patch tests (hair, lash), walk-in queue (barber, nails),
   rooms and packages (spa).
4. **Credit**: packages, memberships, gift cards.
