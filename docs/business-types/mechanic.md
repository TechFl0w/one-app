# Mechanic shop: analysis

What an independent repair shop (1–10 bays) runs on day to day, and how One App covers it. The
template `src/templates/mechanic.ts` builds this. It is the foundation every mechanic starts from;
the owner can then change any screen's design (by asking the assistant) without touching the data
or the rules underneath.

## A day in the shop

1. **Booking.** A customer calls or books online with a car and a complaint ("grinding when
   braking"). It becomes a **job** (work order) booked for a drop-off time.
2. **Check-in.** The car arrives. The shop records the mileage and takes photos of existing
   damage, then gives the customer a promised-by time.
3. **Diagnosis.** A technician inspects the car and writes **lines**: labour (hours × rate) and
   parts (qty × price).
4. **Estimate and approval.** The customer approves or declines each line. Nothing is billed
   without approval (a pending change stays pending until the customer agrees).
5. **Parts.** Parts come from stock or are ordered from a supplier. The job waits for parts until
   they arrive.
6. **Repair.** The job moves across the board: In progress → Quality check → Ready. Each move is a
   drag on the workshop board.
7. **Pickup and payment.** The customer is told it's ready, pays (in full or in part), and the car
   leaves. The job's balance is total minus payments, so it can't drift.
8. **Follow-up.** The next service is due in 6 months or 10,000 km, and the shop sends a reminder
   then. It is re-checked before sending, so it isn't sent if the car already came in or the
   customer left.

## Data model

Everything below is facts. The summaries are computed (rollups, formulas, statuses that follow
rules), so they're always right (`docs/data-rules.md`).

| Table | Key fields | Computed |
|---|---|---|
| **Customers** | name, phone, email, notes | vehicles (count), open jobs, total spent, balance owed |
| **Vehicles** | plate, make & model, year, VIN, mileage, owner → Customer, photo, next service on | jobs (count), last visit, service status: *Due / Due soon / OK* (follows "next service on") |
| **Technicians** | name, phone, hourly rate, active | open jobs |
| **Jobs** (work orders) | title, vehicle → Vehicle, customer → Customer, concern, stage (decided by the shop), technician → Technician, booked for, promised by, mileage in, photo, notes, invoiced on | approved total, quote total, paid, balance (formula), timing: *Late / Due today / On time / Done* (follows promised-by + stage), payment: *Paid / Part paid / Unpaid / –* (follows balance) |
| **Job lines** | job → Job, kind (labour / part), description, part → Part, qty, unit price, approval (proposed / approved / declined, decided by the customer) | line total = qty × unit price (formula) |
| **Parts** (inventory) | name, part number, supplier → Supplier, cost, price, reorder at | received, used, in stock (formula), stock status: *Out / Low / OK* (follows in stock vs reorder level) |
| **Part orders** | part → Part, supplier → Supplier, job → Job (optional), qty, ordered on, received on, cancelled | status: *Cancelled / Received / Ordered / To order* (follows the dates) |
| **Suppliers** | name, phone, email, account no. | open orders |
| **Payments** | job → Job, amount, method, paid on, reference | (settled history: never deleted) |

Stages (the shop decides; stored): Booked → Checked in → Diagnosing → Waiting approval →
Waiting for parts → In progress → Quality check → Ready for pickup → Collected.

## Screens

| Screen | What it does |
|---|---|
| **Today** (home) | Cars in the shop, waiting for approval, ready for pickup, late; today's drop-offs; money owed; low stock |
| **Workshop board** | Jobs by stage. Cards can be dragged between columns. Click a card to open the job page. |
| **Jobs** | All jobs, searchable, newest first. Add a job. |
| **Job page** | The job's details and stage; its lines with totals and per-line approval; payments and balance; the vehicle and customer one click away |
| **Customers / Customer page** | Contact details, their vehicles, job history, balance owed |
| **Vehicles / Vehicle page** | Details, owner, service history (jobs), next service |
| **Calendar** | Jobs by booked-for date |
| **Parts / Part page** | Stock levels with low-stock flags; the part's orders and where it was used |
| **Part orders** | Board: To order → Ordered → Received |
| **Payments** | Money in, and jobs with a balance owed |
| **Technicians / Technician page** | Who is on what |

Every list row and board card opens that record's own page. Adding from a record page (a line on
a job, a vehicle for a customer) pre-fills the link.

## Automations

| When | Only if (re-checked before sending) | Then |
|---|---|---|
| A job's stage changes to Ready for pickup | Stage is still Ready | Message the customer that the car is ready |
| 14 days before a vehicle's next service | Service status isn't OK (no newer visit moved the date) | Service reminder to the owner |
| 2 days after a job enters Waiting approval | Still waiting | Notify the shop to chase the customer |
| 7 days after a job is invoiced | Balance is still above 0 | Payment reminder to the customer |

## What the platform needed for this

These are built once and used by every business type:

- **Formulas**: line totals, balances and stock on hand, computed on read.
- **Record pages**: each record has its own page; blocks on it are scoped to the record.
- **Drag-and-drop boards**: in standard blocks and in generated screens.
- (Later) **Quotes sent for approval**: a customer-facing approve/decline page per job.
- (Later) **Scheduled triggers and capacity**: daily summaries; bays and technician hours for
  booking.
