import type { Automation, Page, Table } from "@/schema/blueprint";
import { hours, list, multi, type Question, type Seed, type Template } from "./types";
import { automation, block, COLORS, datetime, email, finish, link, longText, money, num, optId, page, phone, status, text, check } from "./kit";

/** What kind of appointments: words the questions and suggests services. Everything stays editable. */
const KINDS: Record<string, { label: string; who: string; services: string[] }> = {
  hair: { label: "Hair", who: "Who does the hair?", services: ["Haircut", "Colour", "Blow-dry"] },
  nails: { label: "Nails", who: "Who does the nails?", services: ["Gel manicure", "Classic pedicure", "Nail art"] },
  beauty: { label: "Beauty & skin", who: "Who does the treatments?", services: ["Facial", "Lash lift", "Waxing"] },
  wellness: { label: "Massage & wellness", who: "Who does the treatments?", services: ["60-min massage", "90-min massage"] },
  health: { label: "Health & therapy", who: "Who sees clients?", services: ["First consultation", "Follow-up session"] },
  coaching: { label: "Coaching & lessons", who: "Who teaches or coaches?", services: ["Private session", "Trial lesson"] },
  other: { label: "Something else", who: "Who takes appointments?", services: ["Appointment"] },
};

const kind: Question & { kind: "choice" } = {
  id: "kind",
  kind: "choice",
  label: "What kind of appointments?",
  options: Object.entries(KINDS).map(([id, k]) => ({ id, label: k.label })),
  default: "other",
};
const kindOf = (a: Record<string, unknown>) => KINDS[typeof a.kind === "string" && a.kind in KINDS ? a.kind : "other"];

const team: Question & { kind: "list" } = {
  id: "team",
  kind: "list",
  label: (a) => kindOf(a).who,
  placeholder: "A name",
  hint: "Just you is fine. You can add people later.",
  max: 12,
  default: ["Me"],
};
const services: Question & { kind: "list" } = {
  id: "services",
  kind: "list",
  label: "Your main services",
  placeholder: (a) => `e.g. ${kindOf(a).services[0]}`,
  hint: "Add or remove — durations and prices can be set after.",
  max: 20,
  default: KINDS.other.services,
  defaultFor: (a) => kindOf(a).services,
};
const nineToSix: [string, string][] = [["09:00", "18:00"]];
const opening: Question & { kind: "hours" } = {
  id: "opening",
  kind: "hours",
  label: "When are you open?",
  hint: "Online booking only offers times inside these hours. Each team member can have their own hours later.",
  default: { tue: nineToSix, wed: nineToSix, thu: nineToSix, fri: nineToSix, sat: nineToSix },
};

const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it handle?",
  options: [
    { id: "reminders", label: "Appointment reminders", hint: "WhatsApp message the day before" },
    { id: "deposits", label: "Deposits & payments", hint: "Track what’s paid per booking" },
    { id: "stations", label: "Rooms / stations", hint: "Plan which room or chair each booking uses" },
    { id: "rebook", label: "Rebooking nudges", hint: "Remind clients after 3 weeks" },
    { id: "reviews", label: "Review requests", hint: "Ask happy clients for a review after their visit" },
  ],
  default: ["reminders"],
};

export const appointments: Template = {
  id: "appointments",
  label: "Book appointments",
  description: "Clients book with you or your team: services, calendar, reminders, deposits.",
  businessType: "appointments",
  questions: [kind, team, services, opening, extras],
  build(business, answers) {
    const want = new Set(multi(answers, extras));
    const tables: Table[] = [
      {
        id: "tbl_team",
        label: "Team",
        primaryField: "fld_name",
        fields: [text("fld_name", "Name", true), phone("fld_phone"), { id: "fld_hours", label: "Working hours", type: "hours" }, check("fld_online", "Bookable online")],
      },
      {
        id: "tbl_clients",
        label: "Clients",
        primaryField: "fld_name",
        fields: [
          text("fld_name", "Name", true),
          phone("fld_whatsapp", "WhatsApp"),
          email("fld_email"),
          link("fld_fav_tech", "Usually sees", "tbl_team"),
          longText("fld_notes", "Notes"),
          check("fld_vip", "VIP"),
        ],
      },
      {
        id: "tbl_services",
        label: "Services",
        primaryField: "fld_name",
        fields: [text("fld_name", "Service", true), num("fld_minutes", "Minutes"), money("fld_price", "Price"), num("fld_cleanup", "Cleanup (min)"), check("fld_online", "Bookable online")],
      },
      {
        id: "tbl_bookings",
        label: "Bookings",
        primaryField: "fld_client",
        fields: [
          link("fld_client", "Client", "tbl_clients", { required: true }),
          link("fld_service", "Service", "tbl_services"),
          link("fld_practitioner", "With", "tbl_team"),
          datetime("fld_start", "Start", true),
          datetime("fld_end", "End"),
          status("fld_status", "Status", [["Requested", COLORS.AMBER], ["Booked", COLORS.GREEN], ["Done", COLORS.GREY], ["No-show", COLORS.RED], ["Cancelled", COLORS.GREY]]),
          money("fld_amount", "Amount"),
          longText("fld_notes", "Notes"),
        ],
      },
    ];
    if (want.has("stations")) {
      tables.push({ id: "tbl_stations", label: "Rooms & stations", primaryField: "fld_name", fields: [text("fld_name", "Name", true)] });
      tables[3].fields.push(link("fld_station", "Room / station", "tbl_stations"));
    }
    if (want.has("deposits")) {
      tables[3].fields.push(money("fld_deposit", "Deposit"), status("fld_payment", "Payment", [["Unpaid", COLORS.AMBER], ["Deposit paid", COLORS.BLUE], ["Paid", COLORS.GREEN]]));
      // Online bookings wait in "Awaiting deposit" until paid (or the hold runs out).
      tables[3].fields.push(datetime("fld_hold_until", "Held until"));
      const st = tables[3].fields.find((f) => f.id === "fld_status");
      if (st && "options" in st) st.options.splice(1, 0, { id: optId("Awaiting deposit"), label: "Awaiting deposit", color: COLORS.AMBER });
    }

    const pages: Page[] = [
      page("pg_today", "Today", "sun", 0, [
        block("blk_today_count", "number", [0, 0, 4, 1], { table: "tbl_bookings", agg: "count", filters: [{ field: "fld_start", op: "eq", value: "@today" }] }, { title: "Bookings today" }),
        block("blk_today_revenue", "number", [4, 0, 4, 1], { table: "tbl_bookings", agg: "sum", field: "fld_amount", filters: [{ field: "fld_start", op: "eq", value: "@today" }] }, { title: "Expected today" }),
        block("blk_requests", "number", [8, 0, 4, 1], { table: "tbl_bookings", agg: "count", filters: [{ field: "fld_status", op: "eq", value: optId("Requested") }] }, { title: "Waiting for approval" }),
        block("blk_day", "calendar", [0, 1, 8, 6], { table: "tbl_bookings", field: "fld_start", groupBy: want.has("stations") ? "fld_station" : "fld_practitioner" }, { title: "Today", view: "day" }),
        block("blk_next", "list", [8, 1, 4, 6], { table: "tbl_bookings", filters: [{ field: "fld_start", op: "gte", value: "@now" }], sort: [{ field: "fld_start", dir: "asc" }] }, { title: "Up next" }),
      ]),
      page("pg_calendar", "Calendar", "calendar", 1, [
        block("blk_week", "calendar", [0, 0, 12, 8], { table: "tbl_bookings", field: "fld_start" }, { title: "This week", view: "week" }),
      ]),
      page("pg_bookings", "Bookings", "schedule", 2, [
        block("blk_board", "board", [0, 0, 12, 6], { table: "tbl_bookings", groupBy: "fld_status" }, { title: "By status" }),
        block("blk_new_booking", "form", [0, 6, 4, 6], { table: "tbl_bookings" }, { title: "New booking", fields: ["fld_client", "fld_service", "fld_practitioner", "fld_start", "fld_status"] }),
      ]),
      page("pg_clients", "Clients", "users", 3, [
        block("blk_clients", "table", [0, 0, 8, 7], { table: "tbl_clients", sort: [{ field: "fld_name", dir: "asc" }] }, { title: "All clients" }),
        block("blk_new_client", "form", [8, 0, 4, 6], { table: "tbl_clients" }, { title: "Add a client", fields: ["fld_name", "fld_whatsapp", "fld_email", "fld_fav_tech"] }),
      ]),
      page("pg_services", "Services", "sparkles", 4, [
        block("blk_services", "table", [0, 0, 8, 5], { table: "tbl_services" }, { title: "Menu" }),
        block("blk_team", "list", [8, 0, 4, 5], { table: "tbl_team" }, { title: "Team" }),
      ]),
    ];

    const automations: Automation[] = [];
    if (want.has("reminders")) {
      automations.push(
        automation({
          id: "aut_reminder",
          label: "Reminder the day before",
          trigger: { type: "date_reached", table: "tbl_bookings", field: "fld_start", offset: "-24h" },
          conditions: [{ field: "fld_status", op: "eq", value: optId("Booked") }],
          actions: [{ type: "send_message", channel: "auto", to: "fld_client", template: "tpl_reminder" }],
        }),
      );
    }
    if (want.has("rebook")) {
      automations.push(
        automation({
          id: "aut_rebook",
          label: "Rebooking nudge after 3 weeks",
          trigger: { type: "date_reached", table: "tbl_bookings", field: "fld_start", offset: "+21d" },
          conditions: [{ field: "fld_status", op: "eq", value: optId("Done") }],
          // Only if they haven't booked again already.
          guards: ["no_upcoming_booking"],
          actions: [{ type: "send_message", channel: "auto", to: "fld_client", template: "tpl_rebook" }],
        }),
      );
    }
    if (want.has("reviews")) {
      automations.push(
        automation({
          id: "aut_review",
          label: "Ask for a review after a visit",
          trigger: { type: "status_changed", table: "tbl_bookings", field: "fld_status", to: optId("Done") },
          // Checked again after the wait (a visit changed back from Done gets no request).
          conditions: [{ field: "fld_status", op: "eq", value: optId("Done") }],
          actions: [
            { type: "wait", duration: "2h" },
            { type: "send_message", channel: "auto", to: "fld_client", template: "tpl_review" },
          ],
        }),
      );
    }

    const seed: Seed[] = [
      ...list(answers, team).map((name) => ({ table: "tbl_team", data: { fld_name: name, fld_online: true } })),
      ...list(answers, services).map((name) => ({ table: "tbl_services", data: { fld_name: name, fld_minutes: 60, fld_online: true } })),
      ...(want.has("stations") ? ["Station 1", "Station 2"].map((name) => ({ table: "tbl_stations", data: { fld_name: name } })) : []),
    ];

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "appointments" },
        tables,
        pages,
        automations,
        connections: want.has("deposits") ? [{ id: "con_stripe", provider: "stripe", status: "not_connected" }] : [],
        modules: ["bookings", "messaging", ...(want.has("deposits") ? (["payments"] as const) : [])],
        scheduling: {
          bookings: {
            table: "tbl_bookings", start: "fld_start", end: "fld_end", service: "fld_service", practitioner: "fld_practitioner",
            client: "fld_client", status: "fld_status", amount: "fld_amount", ...(want.has("stations") ? { resource: "fld_station" } : {}),
            ...(want.has("deposits") ? { holdUntil: "fld_hold_until" } : {}),
          },
          services: { table: "tbl_services", duration: "fld_minutes", price: "fld_price", bufferAfter: "fld_cleanup", online: "fld_online" },
          practitioners: { table: "tbl_team", hours: "fld_hours", online: "fld_online" },
          ...(want.has("stations") ? { resources: { table: "tbl_stations" } } : {}),
          clients: { table: "tbl_clients", name: "fld_name", email: "fld_email", phone: "fld_whatsapp" },
          hours: hours(answers, opening),
          rules: { slotStepMin: 15, minNoticeMin: 120, horizonDays: 60, holdMin: 15, cancelWindowHours: 24, autoConfirm: false },
          ...(want.has("deposits") ? { deposit: { kind: "percent" as const, value: 20 } } : {}),
          statuses: {
            requested: optId("Requested"), confirmed: optId("Booked"), completed: optId("Done"), no_show: optId("No-show"), cancelled: optId("Cancelled"),
            ...(want.has("deposits") ? { held: optId("Awaiting deposit") } : {}),
          },
        },
      }),
      seed,
    };
  },
};
