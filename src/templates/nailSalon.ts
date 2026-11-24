import type { Automation, Page, Table } from "@/schema/blueprint";
import { list, multi, type Question, type Seed, type Template } from "./types";
import { automation, block, COLORS, datetime, email, finish, link, longText, money, num, optId, page, phone, status, text, check } from "./kit";

const team: Question & { kind: "list" } = {
  id: "team",
  kind: "list",
  label: "Who does the nails?",
  placeholder: "A name",
  hint: "Just you is fine. You can add people later.",
  max: 12,
  default: ["Me"],
};
const services: Question & { kind: "list" } = {
  id: "services",
  kind: "list",
  label: "Your main services",
  placeholder: "e.g. Gel manicure",
  max: 20,
  default: ["Gel manicure", "Classic pedicure", "Nail art"],
};
const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it handle?",
  options: [
    { id: "reminders", label: "Appointment reminders", hint: "WhatsApp message the day before" },
    { id: "deposits", label: "Deposits & payments", hint: "Track what’s paid per booking" },
    { id: "stations", label: "Stations / chairs", hint: "Plan who sits where" },
    { id: "rebook", label: "Rebooking nudges", hint: "Remind clients after 3 weeks" },
  ],
  default: ["reminders"],
};

export const nailSalon: Template = {
  id: "nail_salon",
  label: "Nail salon",
  description: "Bookings by practitioner, clients, services, reminders and deposits.",
  businessType: "nail_salon",
  questions: [team, services, extras],
  build(business, answers) {
    const want = new Set(multi(answers, extras));
    const tables: Table[] = [
      { id: "tbl_team", label: "Team", primaryField: "fld_name", fields: [text("fld_name", "Name", true), phone("fld_phone")] },
      {
        id: "tbl_clients",
        label: "Clients",
        primaryField: "fld_name",
        fields: [
          text("fld_name", "Name", true),
          phone("fld_whatsapp", "WhatsApp"),
          email("fld_email"),
          link("fld_fav_tech", "Favourite tech", "tbl_team"),
          longText("fld_notes", "Notes"),
          check("fld_vip", "VIP"),
        ],
      },
      {
        id: "tbl_services",
        label: "Services",
        primaryField: "fld_name",
        fields: [text("fld_name", "Service", true), num("fld_minutes", "Minutes"), money("fld_price", "Price")],
      },
      {
        id: "tbl_bookings",
        label: "Bookings",
        primaryField: "fld_client",
        fields: [
          link("fld_client", "Client", "tbl_clients", { required: true }),
          link("fld_service", "Service", "tbl_services"),
          link("fld_practitioner", "Tech", "tbl_team"),
          datetime("fld_start", "Start", true),
          status("fld_status", "Status", [["Requested", COLORS.AMBER], ["Booked", COLORS.GREEN], ["Done", COLORS.GREY], ["No-show", COLORS.RED], ["Cancelled", COLORS.GREY]]),
          money("fld_amount", "Amount"),
          longText("fld_notes", "Notes"),
        ],
      },
    ];
    if (want.has("stations")) {
      tables.push({ id: "tbl_stations", label: "Stations", primaryField: "fld_name", fields: [text("fld_name", "Station", true)] });
      tables[3].fields.push(link("fld_station", "Station", "tbl_stations"));
    }
    if (want.has("deposits")) {
      tables[3].fields.push(money("fld_deposit", "Deposit"), status("fld_payment", "Payment", [["Unpaid", COLORS.AMBER], ["Deposit paid", COLORS.BLUE], ["Paid", COLORS.GREEN]]));
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
          actions: [{ type: "send_message", channel: "whatsapp", to: "fld_client", template: "tpl_reminder" }],
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
          actions: [{ type: "send_message", channel: "whatsapp", to: "fld_client", template: "tpl_rebook" }],
        }),
      );
    }

    const seed: Seed[] = [
      ...list(answers, team).map((name) => ({ table: "tbl_team", data: { fld_name: name } })),
      ...list(answers, services).map((name) => ({ table: "tbl_services", data: { fld_name: name } })),
      ...(want.has("stations") ? ["Station 1", "Station 2"].map((name) => ({ table: "tbl_stations", data: { fld_name: name } })) : []),
    ];

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "nail_salon" },
        tables,
        pages,
        automations,
        connections: want.has("deposits") ? [{ id: "con_stripe", provider: "stripe", status: "not_connected" }] : [],
        modules: ["bookings", "messaging", ...(want.has("deposits") ? (["payments"] as const) : [])],
      }),
      seed,
    };
  },
};
