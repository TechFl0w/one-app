import { Blueprint } from "@/schema/blueprint";
import type { RecordRow } from "@/schema/records";
import { addDays, localToday, startOfLocalDay } from "@/engine/dates";

/**
 * Sample nail salon used by /demo: lets the shell and blocks run without Supabase.
 * Not used by real businesses.
 */

export const DEMO_BUSINESS_ID = "demo";

export const demoBlueprint: Blueprint = Blueprint.parse({
  version: 1,
  business: { name: "Polished Nail Bar", type: "nail_salon", timezone: "America/Vancouver" },
  tables: [
    {
      id: "tbl_team",
      label: "Team",
      primaryField: "fld_name",
      fields: [
        { id: "fld_name", label: "Name", type: "text", required: true },
        { id: "fld_role", label: "Role", type: "choice", options: [{ id: "opt_tech", label: "Nail tech" }, { id: "opt_front", label: "Front desk" }] },
      ],
    },
    {
      id: "tbl_clients",
      label: "Clients",
      primaryField: "fld_name",
      fields: [
        { id: "fld_name", label: "Name", type: "text", required: true },
        { id: "fld_whatsapp", label: "WhatsApp", type: "phone" },
        { id: "fld_email", label: "Email", type: "email" },
        { id: "fld_fav_tech", label: "Favourite tech", type: "link", to: "tbl_team" },
        { id: "fld_vip", label: "VIP", type: "checkbox" },
      ],
    },
    {
      id: "tbl_services",
      label: "Services",
      primaryField: "fld_name",
      fields: [
        { id: "fld_name", label: "Service", type: "text", required: true },
        { id: "fld_minutes", label: "Minutes", type: "number" },
        { id: "fld_price", label: "Price", type: "money", currency: "CAD" },
      ],
    },
    {
      id: "tbl_bookings",
      label: "Bookings",
      primaryField: "fld_client",
      fields: [
        { id: "fld_client", label: "Client", type: "link", to: "tbl_clients", required: true },
        { id: "fld_service", label: "Service", type: "link", to: "tbl_services" },
        { id: "fld_practitioner", label: "Tech", type: "link", to: "tbl_team" },
        { id: "fld_start", label: "Start", type: "datetime", required: true },
        {
          id: "fld_status",
          label: "Status",
          type: "status",
          options: [
            { id: "opt_requested", label: "Requested", color: "#B7791F" },
            { id: "opt_booked", label: "Booked", color: "#17694F" },
            { id: "opt_done", label: "Done", color: "#5E5B55" },
            { id: "opt_no_show", label: "No-show", color: "#B42318" },
          ],
        },
        { id: "fld_amount", label: "Amount", type: "money", currency: "CAD" },
        { id: "fld_notes", label: "Notes", type: "long_text" },
      ],
    },
  ],
  pages: [
    {
      id: "pg_today",
      label: "Today",
      icon: "sun",
      menuOrder: 0,
      hidden: false,
      layout: {
        columns: 12,
        blocks: [
          { id: "blk_rev", type: "number", source: { table: "tbl_bookings", agg: "sum", field: "fld_amount", filters: [{ field: "fld_start", op: "eq", value: "@today" }] }, x: 0, y: 0, w: 4, h: 1, options: { title: "Revenue today" } },
          { id: "blk_count", type: "number", source: { table: "tbl_bookings", agg: "count", filters: [{ field: "fld_start", op: "eq", value: "@today" }] }, x: 4, y: 0, w: 4, h: 1, options: { title: "Bookings today" } },
          { id: "blk_req", type: "number", source: { table: "tbl_bookings", agg: "count", filters: [{ field: "fld_status", op: "eq", value: "opt_requested" }] }, x: 8, y: 0, w: 4, h: 1, options: { title: "Waiting for approval" } },
          { id: "blk_cal", type: "calendar", source: { table: "tbl_bookings", groupBy: "fld_practitioner", field: "fld_start" }, x: 0, y: 1, w: 8, h: 5, options: { title: "Today’s calendar", view: "day" } },
          { id: "blk_next", type: "list", source: { table: "tbl_bookings", filters: [{ field: "fld_start", op: "gte", value: "@now" }], sort: [{ field: "fld_start", dir: "asc" }] }, x: 8, y: 1, w: 4, h: 5, options: { title: "Up next" } },
        ],
      },
    },
    {
      id: "pg_bookings",
      label: "Bookings",
      icon: "calendar",
      menuOrder: 1,
      hidden: false,
      layout: {
        columns: 12,
        blocks: [{ id: "blk_board", type: "board", source: { table: "tbl_bookings", groupBy: "fld_status" }, x: 0, y: 0, w: 12, h: 7, options: { title: "Bookings by status" } }],
      },
    },
    {
      id: "pg_clients",
      label: "Clients",
      icon: "users",
      menuOrder: 2,
      hidden: false,
      layout: {
        columns: 12,
        blocks: [
          { id: "blk_clients", type: "table", source: { table: "tbl_clients", sort: [{ field: "fld_name", dir: "asc" }] }, x: 0, y: 0, w: 8, h: 6, options: { title: "All clients" } },
          { id: "blk_new_client", type: "form", source: { table: "tbl_clients" }, x: 8, y: 0, w: 4, h: 5, options: { title: "Add a client" } },
        ],
      },
    },
    {
      id: "pg_services",
      label: "Services",
      icon: "sparkles",
      menuOrder: 3,
      hidden: false,
      layout: {
        columns: 12,
        blocks: [
          { id: "blk_services", type: "table", source: { table: "tbl_services" }, x: 0, y: 0, w: 8, h: 5, options: { title: "Menu" } },
          { id: "blk_note", type: "notes", x: 8, y: 0, w: 4, h: 3, options: { title: "Pricing notes", text: "Gel removal is free when you rebook within 3 weeks." } },
        ],
      },
    },
    {
      id: "pg_settings",
      label: "Settings",
      icon: "settings",
      menuOrder: 9,
      hidden: true,
      layout: { columns: 12, blocks: [] },
    },
  ],
  automations: [
    {
      id: "aut_reminder",
      label: "Reminder 24h before",
      enabled: true,
      trigger: { type: "date_reached", table: "tbl_bookings", field: "fld_start", offset: "-24h" },
      conditions: [{ field: "fld_status", op: "eq", value: "opt_booked" }],
      actions: [{ type: "send_message", channel: "whatsapp", template: "tpl_reminder" }],
    },
  ],
  connections: [{ id: "con_stripe", provider: "stripe", status: "not_connected" }],
  modules: ["bookings", "messaging"],
});

// ---------- sample records ----------

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Today (in the business timezone) at hh:mm local time, as ISO. */
function todayAt(hour: number, minute = 0, dayOffset = 0): string {
  const tz = demoBlueprint.business.timezone;
  const day = addDays(localToday(new Date(), tz), dayOffset);
  const midnight = startOfLocalDay(day, tz);
  return new Date(midnight.getTime() + (hour * 60 + minute) * 60_000).toISOString();
}

const row = (n: number, tableId: string, data: Record<string, unknown>): RecordRow => ({
  id: id(n),
  tableId,
  data,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
});

export function demoRecords(): RecordRow[] {
  return [
    row(1, "tbl_team", { fld_name: "Mai", fld_role: "opt_tech" }),
    row(2, "tbl_team", { fld_name: "Priya", fld_role: "opt_tech" }),
    row(3, "tbl_team", { fld_name: "Jo", fld_role: "opt_front" }),

    row(10, "tbl_clients", { fld_name: "Ava Thompson", fld_whatsapp: "+1 604 555 0101", fld_email: "ava@example.com", fld_fav_tech: id(1), fld_vip: true }),
    row(11, "tbl_clients", { fld_name: "Ben Ortiz", fld_whatsapp: "+1 604 555 0102", fld_fav_tech: id(2) }),
    row(12, "tbl_clients", { fld_name: "Chloé Martin", fld_email: "chloe@example.com", fld_vip: false }),
    row(13, "tbl_clients", { fld_name: "Dev Patel", fld_whatsapp: "+1 604 555 0104", fld_fav_tech: id(1) }),
    row(14, "tbl_clients", { fld_name: "Elena Rossi", fld_whatsapp: "+1 604 555 0105", fld_vip: true }),

    row(20, "tbl_services", { fld_name: "Gel manicure", fld_minutes: 60, fld_price: 55 }),
    row(21, "tbl_services", { fld_name: "Classic pedicure", fld_minutes: 45, fld_price: 48 }),
    row(22, "tbl_services", { fld_name: "Nail art (per nail)", fld_minutes: 10, fld_price: 5 }),
    row(23, "tbl_services", { fld_name: "Gel removal", fld_minutes: 20, fld_price: 15 }),

    row(30, "tbl_bookings", { fld_client: id(10), fld_service: id(20), fld_practitioner: id(1), fld_start: todayAt(9), fld_status: "opt_done", fld_amount: 55 }),
    row(31, "tbl_bookings", { fld_client: id(11), fld_service: id(21), fld_practitioner: id(2), fld_start: todayAt(10, 30), fld_status: "opt_booked", fld_amount: 48 }),
    row(32, "tbl_bookings", { fld_client: id(12), fld_service: id(20), fld_practitioner: id(1), fld_start: todayAt(12), fld_status: "opt_booked", fld_amount: 55 }),
    row(33, "tbl_bookings", { fld_client: id(13), fld_service: id(23), fld_practitioner: id(2), fld_start: todayAt(14), fld_status: "opt_booked", fld_amount: 15 }),
    row(34, "tbl_bookings", { fld_client: id(14), fld_service: id(20), fld_start: todayAt(15, 30), fld_status: "opt_requested", fld_amount: 55, fld_notes: "Asked for Mai if free" }),
    row(35, "tbl_bookings", { fld_client: id(10), fld_service: id(22), fld_practitioner: id(1), fld_start: todayAt(11, 0, 1), fld_status: "opt_booked", fld_amount: 25 }),
    row(36, "tbl_bookings", { fld_client: id(11), fld_service: id(20), fld_start: todayAt(16, 0, -1), fld_status: "opt_no_show", fld_amount: 0 }),
  ];
}
