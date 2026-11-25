import { Blueprint } from "@/schema/blueprint";

/** A small nail-salon blueprint, close to the one in docs/architecture.md. */
export function salonBlueprint(): Blueprint {
  return Blueprint.parse({
    version: 3,
    business: { name: "Polished Nail Bar", type: "nail_salon", timezone: "America/Vancouver" },
    tables: [
      {
        id: "tbl_team",
        label: "Team",
        fields: [{ id: "fld_name", label: "Name", type: "text", required: true }],
        primaryField: "fld_name",
      },
      {
        id: "tbl_clients",
        label: "Clients",
        fields: [
          { id: "fld_name", label: "Name", type: "text", required: true },
          { id: "fld_whatsapp", label: "WhatsApp", type: "phone" },
          { id: "fld_fav_tech", label: "Favourite tech", type: "link", to: "tbl_team" },
        ],
      },
      {
        id: "tbl_bookings",
        label: "Bookings",
        fields: [
          { id: "fld_start", label: "Start", type: "datetime", required: true },
          { id: "fld_practitioner", label: "Practitioner", type: "link", to: "tbl_team" },
          {
            id: "fld_status",
            label: "Status",
            type: "status",
            options: [
              { id: "opt_booked", label: "Booked" },
              { id: "opt_done", label: "Done" },
            ],
          },
          { id: "fld_amount", label: "Amount", type: "money", currency: "CAD" },
        ],
      },
    ],
    pages: [
      {
        id: "pg_today",
        label: "Today",
        icon: "calendar",
        menuOrder: 0,
        hidden: false,
        layout: {
          columns: 12,
          blocks: [
            { id: "blk_rev", type: "number", source: { table: "tbl_bookings", agg: "sum", field: "fld_amount", filters: [{ field: "fld_start", op: "eq", value: "@today" }] }, x: 0, y: 0, w: 4, h: 1 },
            { id: "blk_cal", type: "calendar", source: { table: "tbl_bookings", groupBy: "fld_practitioner" }, x: 0, y: 1, w: 8, h: 4 },
          ],
        },
      },
      {
        id: "pg_clients",
        label: "Clients",
        icon: "users",
        menuOrder: 1,
        hidden: false,
        layout: { columns: 12, blocks: [{ id: "blk_clients", type: "table", source: { table: "tbl_clients" }, x: 0, y: 0, w: 12, h: 6 }] },
      },
    ],
    automations: [
      {
        id: "aut_reminder",
        label: "Reminder 24h before",
        enabled: true,
        trigger: { type: "date_reached", table: "tbl_bookings", field: "fld_start", offset: "-24h" },
        conditions: [],
        actions: [{ type: "send_message", channel: "whatsapp", template: "tpl_reminder" }],
      },
    ],
    connections: [{ id: "con_stripe", provider: "stripe", status: "connected" }],
    modules: ["bookings", "payments", "messaging"],
  });
}
