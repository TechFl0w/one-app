import type { Automation, Field, Page, Table } from "@/schema/blueprint";
import { choice, list, multi, type Question, type Seed, type Template } from "./types";
import { isoDate, localToday } from "@/engine/dates";
import { automation, block, check, COLORS, date, datetime, derived, email, file, finish, link, longText, money, num, optId, page, phone, status, text } from "./kit";

/**
 * Mechanic shop: the full foundation (docs/business-types/mechanic.md). Customers and their
 * vehicles, jobs (work orders) moving across the workshop board, lines with per-line approval,
 * parts stock, part orders, payments and balances — every total, balance and status is computed,
 * every record has its own page, every board can be dragged.
 */

const technicians: Question & { kind: "list" } = {
  id: "technicians",
  kind: "list",
  label: "Who works on the cars?",
  placeholder: "e.g. Marco",
  hint: "Your technicians (you can add more later).",
  max: 20,
  default: ["Marco", "Jess"],
};
const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it handle?",
  options: [
    { id: "parts", label: "Parts stock & part orders" },
    { id: "payments", label: "Payments & balances" },
    { id: "reminders", label: "Service reminders", hint: "Message owners when a service is due" },
    { id: "updates", label: "“Your car is ready” messages" },
  ],
  default: ["parts", "payments", "reminders", "updates"],
};
const sample: Question & { kind: "choice" } = {
  id: "sample",
  kind: "choice",
  label: "Start with sample customers, cars and jobs?",
  options: [
    { id: "yes", label: "Yes, show me how it works", hint: "Delete them any time" },
    { id: "no", label: "No, start empty" },
  ],
  default: "yes",
};

const PURPLE = "#6B46C1";
const STAGES: [string, string][] = [
  ["Booked", COLORS.BLUE],
  ["Checked in", COLORS.BLUE],
  ["Diagnosing", COLORS.AMBER],
  ["Waiting approval", PURPLE],
  ["Waiting for parts", PURPLE],
  ["In progress", COLORS.AMBER],
  ["Quality check", COLORS.AMBER],
  ["Ready for pickup", COLORS.GREEN],
  ["Collected", COLORS.GREY],
];
const S = (label: string) => optId(label);
const OPEN_STAGE = { field: "fld_j_stage", op: "neq" as const, value: S("Collected") };

const rollup = (f: Omit<Extract<Field, { type: "rollup" }>, "type">): Field => ({ type: "rollup", ...f }) as Field;
const formula = (id: string, label: string, expression: string, format: "money" | "number" = "number"): Field => ({ id, label, type: "formula", expression, format });

export const mechanic: Template = {
  id: "mechanic",
  label: "Repair cars",
  description: "Customers and their cars, jobs on a workshop board, quotes with approval, parts, payments.",
  businessType: "mechanic",
  questions: [technicians, extras, sample],
  build(business, answers) {
    const want = new Set(multi(answers, extras));
    const parts = want.has("parts");
    const payments = want.has("payments");

    const tables: Table[] = [
      {
        id: "tbl_customers",
        label: "Customers",
        primaryField: "fld_c_name",
        fields: [
          text("fld_c_name", "Name", true),
          phone("fld_c_phone"),
          email("fld_c_email"),
          longText("fld_c_notes", "Notes"),
          rollup({ id: "fld_c_vehicles", label: "Vehicles", from: "tbl_vehicles", via: "fld_v_owner", field: "fld_v_plate", agg: "count" }),
          rollup({ id: "fld_c_open_jobs", label: "Open jobs", from: "tbl_jobs", via: "fld_j_customer", field: "fld_j_title", agg: "count", where: [OPEN_STAGE] }),
          ...(payments
            ? [
                rollup({ id: "fld_c_spent", label: "Total paid", from: "tbl_jobs", via: "fld_j_customer", field: "fld_j_paid", agg: "sum", format: "money" }),
                rollup({ id: "fld_c_owed", label: "Owes", from: "tbl_jobs", via: "fld_j_customer", field: "fld_j_balance", agg: "sum", format: "money" }),
              ]
            : []),
        ],
      },
      {
        id: "tbl_vehicles",
        label: "Vehicles",
        primaryField: "fld_v_plate",
        fields: [
          text("fld_v_plate", "Plate", true),
          text("fld_v_model", "Make & model"),
          { ...num("fld_v_year", "Year"), min: 1950, max: 2035 } as Field,
          link("fld_v_owner", "Owner", "tbl_customers", { required: true }),
          text("fld_v_vin", "VIN"),
          { ...num("fld_v_mileage", "Mileage (km)"), min: 0 } as Field,
          date("fld_v_next_service", "Next service"),
          file("fld_v_photo", "Photo"),
          rollup({ id: "fld_v_jobs", label: "Visits", from: "tbl_jobs", via: "fld_j_vehicle", field: "fld_j_title", agg: "count" }),
          rollup({ id: "fld_v_last_visit", label: "Last visit", from: "tbl_jobs", via: "fld_j_vehicle", field: "fld_j_booked", agg: "max", where: [{ field: "fld_j_booked", op: "lte", value: "@now" }] }),
          // Follows the date: "Due" the day it passes, without anyone updating it.
          derived(status("fld_v_service", "Service", [["Not set", COLORS.GREY], ["Due", COLORS.RED], ["Due soon", COLORS.AMBER], ["OK", COLORS.GREEN]]), [
            [[{ field: "fld_v_next_service", op: "empty" }], "Not set"],
            [[{ field: "fld_v_next_service", op: "lte", value: "@today" }], "Due"],
            [[{ field: "fld_v_next_service", op: "lte", value: "@today+30d" }], "Due soon"],
          ], "OK"),
        ],
      },
      {
        id: "tbl_techs",
        label: "Team",
        primaryField: "fld_t_name",
        fields: [
          text("fld_t_name", "Name", true),
          phone("fld_t_phone"),
          money("fld_t_rate", "Labour rate (per hour)"),
          check("fld_t_active", "Works here"),
          rollup({ id: "fld_t_open_jobs", label: "Open jobs", from: "tbl_jobs", via: "fld_j_tech", field: "fld_j_title", agg: "count", where: [OPEN_STAGE] }),
        ],
      },
      {
        id: "tbl_jobs",
        label: "Jobs",
        primaryField: "fld_j_title",
        fields: [
          text("fld_j_title", "Job", true),
          link("fld_j_vehicle", "Vehicle", "tbl_vehicles", { required: true }),
          link("fld_j_customer", "Customer", "tbl_customers", { required: true }),
          status("fld_j_stage", "Stage", STAGES),
          link("fld_j_tech", "Technician", "tbl_techs"),
          longText("fld_j_concern", "Customer's concern"),
          datetime("fld_j_booked", "Drop-off"),
          date("fld_j_promised", "Promised by"),
          { ...num("fld_j_mileage", "Mileage in (km)"), min: 0 } as Field,
          file("fld_j_photo", "Photo at check-in"),
          longText("fld_j_notes", "Workshop notes"),
          ...(payments ? [date("fld_j_invoiced", "Invoiced on")] : []),
          rollup({ id: "fld_j_total", label: "Approved total", from: "tbl_lines", via: "fld_l_job", field: "fld_l_total", agg: "sum", where: [{ field: "fld_l_approval", op: "eq", value: S("Approved") }], format: "money" }),
          rollup({ id: "fld_j_quote", label: "Quote total", from: "tbl_lines", via: "fld_l_job", field: "fld_l_total", agg: "sum", where: [{ field: "fld_l_approval", op: "neq", value: S("Declined") }], format: "money" }),
          ...(payments
            ? [
                rollup({ id: "fld_j_paid", label: "Paid", from: "tbl_payments", via: "fld_pay_job", field: "fld_pay_amount", agg: "sum", format: "money" }),
                formula("fld_j_balance", "Balance", "fld_j_total - fld_j_paid", "money"),
                derived(status("fld_j_payment", "Payment", [["No charges", COLORS.GREY], ["Paid", COLORS.GREEN], ["Part paid", COLORS.AMBER], ["Unpaid", COLORS.RED]]), [
                  [[{ field: "fld_j_total", op: "lte", value: 0 }], "No charges"],
                  [[{ field: "fld_j_balance", op: "lte", value: 0 }], "Paid"],
                  [[{ field: "fld_j_paid", op: "gt", value: 0 }], "Part paid"],
                ], "Unpaid"),
              ]
            : []),
          // On time or late, from the promised date and the stage — never set by hand.
          derived(status("fld_j_timing", "Timing", [["Done", COLORS.GREY], ["Late", COLORS.RED], ["Due today", COLORS.AMBER], ["On time", COLORS.GREEN]], "choice"), [
            [[{ field: "fld_j_stage", op: "eq", value: S("Ready for pickup") }], "Done"],
            [[{ field: "fld_j_stage", op: "eq", value: S("Collected") }], "Done"],
            [[{ field: "fld_j_promised", op: "lt", value: "@today" }], "Late"],
            [[{ field: "fld_j_promised", op: "eq", value: "@today" }], "Due today"],
          ], "On time"),
        ],
      },
      {
        id: "tbl_lines",
        label: "Job lines",
        primaryField: "fld_l_desc",
        openIn: "modal",
        fields: [
          text("fld_l_desc", "Description", true),
          link("fld_l_job", "Job", "tbl_jobs", { required: true }),
          status("fld_l_kind", "Kind", [["Labour", COLORS.BLUE], ["Part", COLORS.AMBER], ["Other", COLORS.GREY]], "choice"),
          ...(parts ? [link("fld_l_part", "Part from stock", "tbl_parts")] : []),
          { ...num("fld_l_qty", "Qty / hours"), required: true, min: 0 } as Field,
          { ...money("fld_l_price", "Unit price"), required: true } as Field,
          // The customer's decision on this line; only approved lines are billed.
          status("fld_l_approval", "Approval", [["Proposed", COLORS.AMBER], ["Approved", COLORS.GREEN], ["Declined", COLORS.GREY]]),
          formula("fld_l_total", "Line total", "round(fld_l_qty * fld_l_price, 2)", "money"),
        ],
      },
    ];

    if (parts) {
      tables.push(
        {
          id: "tbl_suppliers",
          label: "Suppliers",
          primaryField: "fld_s_name",
          fields: [
            text("fld_s_name", "Supplier", true),
            phone("fld_s_phone"),
            email("fld_s_email"),
            text("fld_s_account", "Account number"),
            rollup({ id: "fld_s_open", label: "Open orders", from: "tbl_orders", via: "fld_o_supplier", field: "fld_o_qty", agg: "count", where: [{ field: "fld_o_stage", op: "eq", value: S("Ordered") }] }),
          ],
        },
        {
          id: "tbl_parts",
          label: "Parts",
          primaryField: "fld_p_name",
          fields: [
            text("fld_p_name", "Part", true),
            text("fld_p_number", "Part number"),
            link("fld_p_supplier", "Supplier", "tbl_suppliers"),
            money("fld_p_cost", "Cost"),
            money("fld_p_price", "Sell price"),
            { ...num("fld_p_start", "Stock count"), min: 0, description: "How many you had when you started tracking" } as Field,
            { ...num("fld_p_reorder", "Reorder at"), min: 0 } as Field,
            rollup({ id: "fld_p_received", label: "Received", from: "tbl_orders", via: "fld_o_part", field: "fld_o_qty", agg: "sum", where: [{ field: "fld_o_stage", op: "eq", value: S("Received") }] }),
            rollup({ id: "fld_p_used", label: "Used on jobs", from: "tbl_lines", via: "fld_l_part", field: "fld_l_qty", agg: "sum", where: [{ field: "fld_l_approval", op: "eq", value: S("Approved") }] }),
            formula("fld_p_stock", "In stock", "fld_p_start + fld_p_received - fld_p_used"),
            formula("fld_p_low", "Below reorder level", "if(fld_p_stock <= fld_p_reorder, 1, 0)"),
            derived(status("fld_p_level", "Stock", [["Out", COLORS.RED], ["Low", COLORS.AMBER], ["OK", COLORS.GREEN]]), [
              [[{ field: "fld_p_stock", op: "lte", value: 0 }], "Out"],
              [[{ field: "fld_p_low", op: "eq", value: 1 }], "Low"],
            ], "OK"),
          ],
        },
        {
          id: "tbl_orders",
          label: "Part orders",
          primaryField: "fld_o_part",
          fields: [
            link("fld_o_part", "Part", "tbl_parts", { required: true }),
            { ...num("fld_o_qty", "Qty"), required: true, min: 1 } as Field,
            link("fld_o_supplier", "Supplier", "tbl_suppliers"),
            link("fld_o_job", "For job", "tbl_jobs"),
            // Moved along on the board by whoever orders / receives the parts.
            status("fld_o_stage", "Stage", [["To order", COLORS.AMBER], ["Ordered", COLORS.BLUE], ["Received", COLORS.GREEN], ["Cancelled", COLORS.GREY]]),
            date("fld_o_ordered", "Ordered on"),
            date("fld_o_expected", "Expected"),
          ],
        },
      );
    }
    if (payments) {
      tables.push({
        id: "tbl_payments",
        label: "Payments",
        primaryField: "fld_pay_title",
        openIn: "modal",
        fields: [
          text("fld_pay_title", "Payment", true),
          link("fld_pay_job", "Job", "tbl_jobs", { required: true }),
          { ...money("fld_pay_amount", "Amount"), required: true } as Field,
          status("fld_pay_method", "Method", [["Card"], ["Cash"], ["E-transfer"], ["Other"]], "choice"),
          date("fld_pay_on", "Paid on", true),
        ],
      });
    }

    // ---------- pages ----------
    const jobCols = (...ids: string[]) => ({ columns: ids });
    const pages: Page[] = [
      page("pg_today", "Today", "sun", 0, [
        block("blk_t_shop", "number", [0, 0, 3, 1], { table: "tbl_jobs", agg: "count", filters: [OPEN_STAGE] }, { title: "Cars in the shop" }),
        block("blk_t_approval", "number", [3, 0, 3, 1], { table: "tbl_jobs", agg: "count", filters: [{ field: "fld_j_stage", op: "eq", value: S("Waiting approval") }] }, { title: "Waiting for approval" }),
        block("blk_t_ready", "number", [6, 0, 3, 1], { table: "tbl_jobs", agg: "count", filters: [{ field: "fld_j_stage", op: "eq", value: S("Ready for pickup") }] }, { title: "Ready for pickup" }),
        block("blk_t_late", "number", [9, 0, 3, 1], { table: "tbl_jobs", agg: "count", filters: [{ field: "fld_j_timing", op: "eq", value: S("Late") }] }, { title: "Late" }),
        block("blk_t_dropoffs", "list", [0, 1, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_booked", op: "eq", value: "@today" }], sort: [{ field: "fld_j_booked", dir: "asc" }] }, { title: "Drop-offs today", fields: ["fld_j_vehicle", "fld_j_customer", "fld_j_stage", "fld_j_booked"] }),
        block("blk_t_late_list", "list", [6, 1, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_timing", op: "eq", value: S("Late") }], sort: [{ field: "fld_j_promised", dir: "asc" }] }, { title: "Late — let the customer know", fields: ["fld_j_customer", "fld_j_vehicle", "fld_j_stage", "fld_j_promised"] }),
        block("blk_t_ready_list", "list", [0, 4, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_stage", op: "eq", value: S("Ready for pickup") }] }, { title: "Ready for pickup", fields: ["fld_j_customer", "fld_j_vehicle", ...(payments ? ["fld_j_balance", "fld_j_payment"] : [])] }),
        ...(payments
          ? [block("blk_t_owed", "list", [6, 4, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_balance", op: "gt", value: 0 }], sort: [{ field: "fld_j_balance", dir: "desc" }] }, { title: "Money owed", fields: ["fld_j_customer", "fld_j_balance", "fld_j_payment"] })]
          : []),
        ...(parts ? [block("blk_t_stock", "list", [0, 7, 12, 3], { table: "tbl_parts", filters: [{ field: "fld_p_level", op: "neq", value: S("OK") }] }, { title: "Parts to reorder", fields: ["fld_p_level", "fld_p_stock", "fld_p_reorder", "fld_p_supplier"] })] : []),
      ]),
      page("pg_workshop", "Workshop", "wrench", 1, [
        block("blk_w_board", "board", [0, 0, 12, 7], { table: "tbl_jobs", groupBy: "fld_j_stage", filters: [OPEN_STAGE], sort: [{ field: "fld_j_promised", dir: "asc" }] }, { title: "Jobs by stage — drag a card to move it", fields: ["fld_j_vehicle", "fld_j_customer", "fld_j_tech", "fld_j_timing"] }),
      ]),
      page("pg_jobs", "Jobs", "clipboard", 2, [
        block("blk_j_table", "table", [0, 0, 12, 8], { table: "tbl_jobs", sort: [{ field: "fld_j_booked", dir: "desc" }] }, { title: "All jobs", ...jobCols("fld_j_title", "fld_j_vehicle", "fld_j_customer", "fld_j_stage", "fld_j_timing", "fld_j_promised", ...(payments ? ["fld_j_total", "fld_j_payment"] : ["fld_j_quote"])) }),
      ]),
      page("pg_calendar", "Calendar", "calendar", 3, [
        block("blk_cal", "calendar", [0, 0, 12, 8], { table: "tbl_jobs", field: "fld_j_booked", groupBy: "fld_j_tech" }, { title: "Drop-offs", view: "week" }),
      ]),
      page("pg_customers", "Customers", "users", 4, [
        block("blk_c_table", "table", [0, 0, 12, 8], { table: "tbl_customers", sort: [{ field: "fld_c_name", dir: "asc" }] }, { title: "Customers", columns: ["fld_c_name", "fld_c_phone", "fld_c_email", "fld_c_vehicles", "fld_c_open_jobs", ...(payments ? ["fld_c_owed"] : [])] }),
      ]),
      page("pg_vehicles", "Vehicles", "car", 5, [
        block("blk_v_table", "table", [0, 0, 12, 8], { table: "tbl_vehicles", sort: [{ field: "fld_v_plate", dir: "asc" }] }, { title: "Vehicles", columns: ["fld_v_plate", "fld_v_model", "fld_v_year", "fld_v_owner", "fld_v_service", "fld_v_next_service", "fld_v_last_visit"] }),
      ]),
      ...(parts
        ? [
            page("pg_parts", "Parts", "box", 6, [
              block("blk_p_table", "table", [0, 0, 12, 6], { table: "tbl_parts", sort: [{ field: "fld_p_name", dir: "asc" }] }, { title: "Parts in stock", columns: ["fld_p_name", "fld_p_number", "fld_p_supplier", "fld_p_stock", "fld_p_level", "fld_p_price"] }),
            ]),
            page("pg_orders", "Part orders", "truck", 7, [
              block("blk_o_board", "board", [0, 0, 12, 5], { table: "tbl_orders", groupBy: "fld_o_stage", sort: [{ field: "fld_o_expected", dir: "asc" }] }, { title: "Part orders — drag to Ordered / Received", fields: ["fld_o_qty", "fld_o_supplier", "fld_o_job", "fld_o_expected"] }),
              block("blk_o_suppliers", "table", [0, 6, 12, 3], { table: "tbl_suppliers", sort: [{ field: "fld_s_name", dir: "asc" }] }, { title: "Suppliers" }),
            ]),
          ]
        : []),
      ...(payments
        ? [
            page("pg_payments", "Payments", "payments", 8, [
              block("blk_pay_owed", "table", [0, 0, 12, 4], { table: "tbl_jobs", filters: [{ field: "fld_j_balance", op: "gt", value: 0 }], sort: [{ field: "fld_j_promised", dir: "asc" }] }, { title: "Jobs with money owed", columns: ["fld_j_title", "fld_j_customer", "fld_j_total", "fld_j_paid", "fld_j_balance", "fld_j_payment"] }),
              block("blk_pay_list", "table", [0, 4, 12, 5], { table: "tbl_payments", sort: [{ field: "fld_pay_on", dir: "desc" }] }, { title: "Payments received" }),
            ]),
          ]
        : []),
      page("pg_team", "Team", "team", 9, [
        block("blk_team", "table", [0, 0, 12, 5], { table: "tbl_techs", sort: [{ field: "fld_t_name", dir: "asc" }] }, { title: "Technicians" }),
      ]),

      // ---------- record pages ----------
      recordPage("pg_r_job", "Job", "tbl_jobs", [
        block("blk_rj_details", "details", [0, 0, 5, 8], { table: "tbl_jobs" }),
        block("blk_rj_lines", "table", [5, 0, 7, 5], { table: "tbl_lines", filters: [{ field: "fld_l_job", op: "eq", value: "@record" }], sort: [{ field: "_created_at", dir: "asc" }] }, { title: "Work & parts — open a line to approve or decline it", columns: ["fld_l_desc", "fld_l_approval", "fld_l_qty", "fld_l_price", "fld_l_total"] }),
        ...(payments
          ? [block("blk_rj_payments", "table", [5, 5, 7, 3], { table: "tbl_payments", filters: [{ field: "fld_pay_job", op: "eq", value: "@record" }], sort: [{ field: "fld_pay_on", dir: "desc" }] }, { title: "Payments", columns: ["fld_pay_title", "fld_pay_amount", "fld_pay_method", "fld_pay_on"] })]
          : []),
        ...(parts ? [block("blk_rj_orders", "table", [0, 8, 12, 2], { table: "tbl_orders", filters: [{ field: "fld_o_job", op: "eq", value: "@record" }] }, { title: "Parts ordered for this job", columns: ["fld_o_part", "fld_o_qty", "fld_o_supplier", "fld_o_stage", "fld_o_expected"] })] : []),
      ]),
      recordPage("pg_r_vehicle", "Vehicle", "tbl_vehicles", [
        block("blk_rv_details", "details", [0, 0, 5, 6], { table: "tbl_vehicles" }),
        block("blk_rv_jobs", "table", [5, 0, 7, 6], { table: "tbl_jobs", filters: [{ field: "fld_j_vehicle", op: "eq", value: "@record" }], sort: [{ field: "fld_j_booked", dir: "desc" }] }, { title: "Service history", columns: ["fld_j_title", "fld_j_booked", "fld_j_stage", "fld_j_mileage", "fld_j_quote"] }),
      ]),
      recordPage("pg_r_customer", "Customer", "tbl_customers", [
        block("blk_rc_details", "details", [0, 0, 5, 6], { table: "tbl_customers" }),
        block("blk_rc_vehicles", "table", [5, 0, 7, 3], { table: "tbl_vehicles", filters: [{ field: "fld_v_owner", op: "eq", value: "@record" }] }, { title: "Vehicles", columns: ["fld_v_plate", "fld_v_model", "fld_v_year", "fld_v_service"] }),
        block("blk_rc_jobs", "table", [5, 3, 7, 5], { table: "tbl_jobs", filters: [{ field: "fld_j_customer", op: "eq", value: "@record" }], sort: [{ field: "fld_j_booked", dir: "desc" }] }, { title: "Jobs", columns: ["fld_j_title", "fld_j_vehicle", "fld_j_stage", ...(payments ? ["fld_j_total", "fld_j_balance"] : [])] }),
      ]),
      ...(parts
        ? [
            recordPage("pg_r_part", "Part", "tbl_parts", [
              block("blk_rp_details", "details", [0, 0, 5, 7], { table: "tbl_parts" }),
              block("blk_rp_orders", "table", [5, 0, 7, 3], { table: "tbl_orders", filters: [{ field: "fld_o_part", op: "eq", value: "@record" }] }, { title: "Orders", columns: ["fld_o_qty", "fld_o_supplier", "fld_o_stage", "fld_o_ordered", "fld_o_expected"] }),
              block("blk_rp_used", "table", [5, 3, 7, 4], { table: "tbl_lines", filters: [{ field: "fld_l_part", op: "eq", value: "@record" }] }, { title: "Used on jobs", columns: ["fld_l_desc", "fld_l_job", "fld_l_qty", "fld_l_approval"] }),
            ]),
          ]
        : []),
    ];

    // ---------- automations (conditions are checked again right before sending) ----------
    const automations: Automation[] = [];
    if (want.has("updates"))
      automations.push(
        automation({
          id: "aut_ready",
          label: "Tell the customer their car is ready",
          trigger: { type: "status_changed", table: "tbl_jobs", field: "fld_j_stage", to: S("Ready for pickup") },
          conditions: [{ field: "fld_j_stage", op: "eq", value: S("Ready for pickup") }],
          actions: [{ type: "send_message", channel: "auto", to: "fld_j_customer", message: "Good news — your car is ready for pickup ({{fld_j_title}})." }],
        }),
      );
    if (want.has("reminders"))
      automations.push(
        automation({
          id: "aut_service_due",
          label: "Service reminder 2 weeks ahead",
          trigger: { type: "date_reached", table: "tbl_vehicles", field: "fld_v_next_service", offset: "-14d" },
          conditions: [{ field: "fld_v_service", op: "eq", value: S("Due soon") }],
          actions: [{ type: "send_message", channel: "auto", to: "fld_v_owner", message: "Your {{fld_v_model}} ({{fld_v_plate}}) is due for a service on {{fld_v_next_service}}. Reply to book a time." }],
        }),
      );
    automations.push(
      automation({
        id: "aut_chase_approval",
        label: "Chase approvals after 2 days",
        trigger: { type: "status_changed", table: "tbl_jobs", field: "fld_j_stage", to: S("Waiting approval") },
        conditions: [{ field: "fld_j_stage", op: "eq", value: S("Waiting approval") }],
        actions: [{ type: "wait", duration: "2d" }, { type: "notify", message: "Still waiting for approval: {{fld_j_title}}" }],
      }),
    );
    if (payments)
      automations.push(
        automation({
          id: "aut_payment_reminder",
          label: "Payment reminder a week after invoicing",
          trigger: { type: "date_reached", table: "tbl_jobs", field: "fld_j_invoiced", offset: "+7d" },
          conditions: [{ field: "fld_j_payment", op: "neq", value: S("Paid") }, { field: "fld_j_payment", op: "neq", value: S("No charges") }],
          actions: [{ type: "send_message", channel: "auto", to: "fld_j_customer", message: "A friendly reminder: there's an open balance for {{fld_j_title}}. Thank you!" }],
        }),
      );

    const seed: Seed[] = list(answers, technicians).map((name, i) => ({ table: "tbl_techs", ref: `tech${i}`, data: { fld_t_name: name, fld_t_active: true, fld_t_rate: 120 } }));
    if (choice(answers, sample) === "yes") seed.push(...sampleData(isoDate(localToday(new Date(), business.timezone)), parts, payments, seed.length > 0));

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "mechanic" },
        tables,
        pages,
        automations,
        connections: [{ id: "con_stripe", provider: "stripe", status: "not_connected" }],
        modules: ["payments", "messaging"],
      }),
      seed,
    };
  },
};

function recordPage(id: string, label: string, table: string, blocks: Page["layout"]["blocks"]): Page {
  return { id, label, menuOrder: 99, hidden: true, recordOf: table, layout: { columns: 12, blocks } };
}

/** Sample shop, dated around today so every status shows (late, due today, ready, paid, owing…). */
function sampleData(today: string, parts: boolean, payments: boolean, hasTech: boolean): Seed[] {
  // Dates around the business's own today (its timezone), so "late" and "due today" are right.
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const at = (n: number, h: number) => `${day(n)}T${String(h).padStart(2, "0")}:00:00.000Z`;
  const tech = hasTech ? { fld_j_tech: "@ref:tech0" } : {};
  const tech2 = hasTech ? { fld_j_tech: "@ref:tech1" } : {};
  const out: Seed[] = [
    { table: "tbl_customers", ref: "sam", data: { fld_c_name: "Sam Okafor", fld_c_phone: "+1 604 555 0144", fld_c_email: "sam@example.com" } },
    { table: "tbl_customers", ref: "dana", data: { fld_c_name: "Dana Ruiz", fld_c_phone: "+1 604 555 0177", fld_c_email: "dana@example.com" } },
    { table: "tbl_customers", ref: "lee", data: { fld_c_name: "Lee Park", fld_c_email: "lee@example.com" } },
    { table: "tbl_vehicles", ref: "corolla", data: { fld_v_plate: "BC 4KX 21", fld_v_model: "Toyota Corolla", fld_v_year: 2016, fld_v_owner: "@ref:sam", fld_v_mileage: 142300, fld_v_next_service: day(10) } },
    { table: "tbl_vehicles", ref: "civic", data: { fld_v_plate: "BC 9RT 07", fld_v_model: "Honda Civic", fld_v_year: 2019, fld_v_owner: "@ref:dana", fld_v_mileage: 61200, fld_v_next_service: day(-3) } },
    { table: "tbl_vehicles", ref: "f150", data: { fld_v_plate: "BC 2LM 88", fld_v_model: "Ford F-150", fld_v_year: 2021, fld_v_owner: "@ref:lee", fld_v_mileage: 38900, fld_v_next_service: day(120) } },
    { table: "tbl_jobs", ref: "brakes", data: { fld_j_title: "Front brakes grinding", fld_j_vehicle: "@ref:corolla", fld_j_customer: "@ref:sam", fld_j_stage: S("In progress"), fld_j_booked: at(-2, 15), fld_j_promised: day(-1), fld_j_mileage: 142300, fld_j_concern: "Grinding noise when braking, worse in the morning.", ...tech } },
    { table: "tbl_jobs", ref: "service", data: { fld_j_title: "60,000 km service", fld_j_vehicle: "@ref:civic", fld_j_customer: "@ref:dana", fld_j_stage: S("Waiting approval"), fld_j_booked: at(0, 16), fld_j_promised: day(0), fld_j_mileage: 61200, ...tech2 } },
    { table: "tbl_jobs", ref: "aircon", data: { fld_j_title: "A/C not blowing cold", fld_j_vehicle: "@ref:f150", fld_j_customer: "@ref:lee", fld_j_stage: S("Ready for pickup"), fld_j_booked: at(-4, 16), fld_j_promised: day(-1), ...(payments ? { fld_j_invoiced: day(-1) } : {}), ...tech } },
    { table: "tbl_jobs", data: { fld_j_title: "Check engine light", fld_j_vehicle: "@ref:corolla", fld_j_customer: "@ref:sam", fld_j_stage: S("Booked"), fld_j_booked: at(1, 15), fld_j_promised: day(2) } },
    { table: "tbl_lines", data: { fld_l_desc: "Brake pads (front set)", fld_l_job: "@ref:brakes", fld_l_kind: S("Part"), fld_l_qty: 1, fld_l_price: 85, fld_l_approval: S("Approved"), ...(parts ? { fld_l_part: "@ref:pads" } : {}) } },
    { table: "tbl_lines", data: { fld_l_desc: "Rotors", fld_l_job: "@ref:brakes", fld_l_kind: S("Part"), fld_l_qty: 2, fld_l_price: 70, fld_l_approval: S("Approved") } },
    { table: "tbl_lines", data: { fld_l_desc: "Labour: replace pads and rotors", fld_l_job: "@ref:brakes", fld_l_kind: S("Labour"), fld_l_qty: 1.5, fld_l_price: 120, fld_l_approval: S("Approved") } },
    { table: "tbl_lines", data: { fld_l_desc: "Oil & filter", fld_l_job: "@ref:service", fld_l_kind: S("Part"), fld_l_qty: 1, fld_l_price: 65, fld_l_approval: S("Proposed"), ...(parts ? { fld_l_part: "@ref:oil" } : {}) } },
    { table: "tbl_lines", data: { fld_l_desc: "Labour: 60k inspection", fld_l_job: "@ref:service", fld_l_kind: S("Labour"), fld_l_qty: 2, fld_l_price: 120, fld_l_approval: S("Proposed") } },
    { table: "tbl_lines", data: { fld_l_desc: "Cabin air filter", fld_l_job: "@ref:service", fld_l_kind: S("Part"), fld_l_qty: 1, fld_l_price: 35, fld_l_approval: S("Declined") } },
    { table: "tbl_lines", data: { fld_l_desc: "A/C recharge", fld_l_job: "@ref:aircon", fld_l_kind: S("Labour"), fld_l_qty: 1, fld_l_price: 180, fld_l_approval: S("Approved") } },
  ];
  if (parts) {
    out.splice(
      0,
      0,
      { table: "tbl_suppliers", ref: "napa", data: { fld_s_name: "Coast Auto Parts", fld_s_phone: "+1 604 555 0100", fld_s_account: "CA-20391" } },
      { table: "tbl_parts", ref: "pads", data: { fld_p_name: "Brake pads (front set)", fld_p_number: "BP-1123", fld_p_supplier: "@ref:napa", fld_p_cost: 42, fld_p_price: 85, fld_p_start: 4, fld_p_reorder: 2 } },
      { table: "tbl_parts", ref: "oil", data: { fld_p_name: "Oil filter", fld_p_number: "OF-220", fld_p_supplier: "@ref:napa", fld_p_cost: 8, fld_p_price: 18, fld_p_start: 12, fld_p_reorder: 5 } },
      { table: "tbl_parts", data: { fld_p_name: "Wiper blades (pair)", fld_p_number: "WB-55", fld_p_supplier: "@ref:napa", fld_p_cost: 14, fld_p_price: 32, fld_p_start: 1, fld_p_reorder: 3 } },
    );
    out.push({ table: "tbl_orders", data: { fld_o_part: "@ref:pads", fld_o_qty: 4, fld_o_supplier: "@ref:napa", fld_o_stage: S("Ordered"), fld_o_ordered: day(-1), fld_o_expected: day(1) } });
  }
  if (payments) out.push({ table: "tbl_payments", data: { fld_pay_title: "Deposit", fld_pay_job: "@ref:brakes", fld_pay_amount: 100, fld_pay_method: S("Card"), fld_pay_on: day(-2) } });
  return out;
}
