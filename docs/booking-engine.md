# Booking engine

A booking = **service × practitioner × resource × time**.

## Entities
- **Resource**: chair, station, bay, room, court. Has a `type`, availability (hours, exceptions, holidays, blocks).
- **Practitioner**: working hours, time off, breaks, skills (services they can do), optional per-person price/duration, daily max.
- **Service**: duration, buffer before/after, price (fixed / from / quote), required resource type + skill,
  add-ons (extra time + price), optional multi-step (e.g. processing gap where practitioner is free).
- **Booking**: status `requested → held → confirmed → checked_in → completed → paid`, plus `cancelled`, `no_show`.
  Holds expire (e.g. 15 min awaiting deposit).

## Slot finding
Free slot = practitioner available ∧ a matching resource free ∧ fits duration + buffers, then filtered by rules:
minimum notice, booking horizon, slot step (e.g. 15 min), "any practitioner" vs specific, gap-avoidance packing.
Must be pure, deterministic and heavily unit-tested (timezones, DST, overlapping buffers).

## Modes
1. **Exact time** (salons, clinics) — v1.
2. **Capacity / drop-off** (mechanics, repairs) — books daily capacity per resource; job may span days;
   quote → approval → work. Design the schema for it now, build it in phase 2.
Later: travel time + service area (mobile), group capacity + waitlist (classes), recurring bookings.

## Policies
Deposits, cancellation window, late-cancel fee, no-show rule, reminders, rebooking nudges, review requests.
