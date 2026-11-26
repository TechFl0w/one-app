import type { Automation, Field, Page, Table } from "@/schema/blueprint";
import { choice, list, multi, type Question, type Template } from "./types";
import { automation, block, COLORS, date, derived, email, file, finish, link, longText, money, optId, page, phone, status, text } from "./kit";

const chairs: Question & { kind: "list" } = {
  id: "chairs",
  kind: "list",
  label: "Which chairs or booths do you rent out?",
  placeholder: "e.g. Chair 1",
  max: 30,
  default: ["Chair 1", "Chair 2", "Chair 3"],
};
const period: Question & { kind: "choice" } = {
  id: "period",
  kind: "choice",
  label: "How often do renters pay?",
  options: [
    { id: "weekly", label: "Every week" },
    { id: "monthly", label: "Every month" },
  ],
  default: "weekly",
};
const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it handle?",
  options: [
    { id: "documents", label: "Licences & insurance", hint: "Expiry dates with reminders" },
    { id: "applicants", label: "Applicants", hint: "People who want to rent a chair" },
    { id: "rent_reminders", label: "Rent reminders", hint: "Message renters before rent is due" },
  ],
  default: ["documents", "applicants", "rent_reminders"],
};

export const chairRental: Template = {
  id: "chair_rental",
  label: "Rent out chairs or booths",
  description: "Renters, rent due, payments, documents with expiry, applicants.",
  businessType: "chair_rental",
  questions: [chairs, period, extras],
  build(business, answers) {
    const want = new Set(multi(answers, extras));
    const weekly = choice(answers, period) === "weekly";
    // The renter's (derived) status on their payments and documents, so reminders skip people who left.
    const renterStatus: Field = { id: "fld_renter_status", label: "Renter status", type: "rollup", via: "fld_renter", field: "fld_status", agg: "latest" };
    const tables: Table[] = [
      { id: "tbl_chairs", label: "Chairs", primaryField: "fld_name", fields: [text("fld_name", "Chair", true), status("fld_status", "Status", [["Available", COLORS.GREEN], ["Rented", COLORS.BLUE], ["Out of use", COLORS.GREY]])] },
      {
        id: "tbl_renters",
        label: "Renters",
        primaryField: "fld_name",
        fields: [
          text("fld_name", "Name", true),
          phone("fld_phone"),
          email("fld_email"),
          link("fld_chair", "Chair", "tbl_chairs"),
          date("fld_start", "Starts"),
          date("fld_end", "Leaves on"),
          money("fld_rent", weekly ? "Weekly rent" : "Monthly rent"),
          // Follows the dates, never set by hand: it can't say "active" for someone who left.
          derived(status("fld_status", "Status", [["Starting", COLORS.BLUE], ["Active", COLORS.GREEN], ["Notice given", COLORS.AMBER], ["Ended", COLORS.GREY]]), [
            [[{ field: "fld_end", op: "lt", value: "@today" }], "Ended"],
            [[{ field: "fld_start", op: "gt", value: "@today" }], "Starting"],
            [[{ field: "fld_end", op: "not_empty" }], "Notice given"],
          ], "Active"),
        ],
      },
      {
        id: "tbl_rent",
        label: "Rent payments",
        primaryField: "fld_renter",
        fields: [
          link("fld_renter", "Renter", "tbl_renters", { required: true }),
          date("fld_due", "Due", true),
          money("fld_amount", "Amount"),
          date("fld_paid_on", "Paid on"),
          derived(status("fld_status", "Status", [["Due", COLORS.AMBER], ["Paid", COLORS.GREEN], ["Late", COLORS.RED]]), [
            [[{ field: "fld_paid_on", op: "not_empty" }], "Paid"],
            [[{ field: "fld_due", op: "lt", value: "@today" }], "Late"],
          ], "Due"),
          renterStatus,
        ],
      },
    ];
    if (want.has("documents")) {
      tables.push({
        id: "tbl_documents",
        label: "Documents",
        primaryField: "fld_kind",
        fields: [
          link("fld_renter", "Renter", "tbl_renters", { required: true }),
          status("fld_kind", "Type", [["Licence"], ["Insurance"], ["Agreement"]], "choice"),
          date("fld_expires", "Expires"),
          file("fld_file", "File"),
          renterStatus,
        ],
      });
    }
    if (want.has("applicants")) {
      tables.push({
        id: "tbl_applicants",
        label: "Applicants",
        primaryField: "fld_name",
        fields: [
          text("fld_name", "Name", true),
          phone("fld_phone"),
          email("fld_email"),
          status("fld_stage", "Stage", [["New", COLORS.AMBER], ["Viewing", COLORS.BLUE], ["Approved", COLORS.GREEN], ["Declined", COLORS.GREY]]),
          longText("fld_notes", "Notes"),
        ],
      });
    }

    const pages: Page[] = [
      page("pg_overview", "Overview", "home", 0, [
        block("blk_rented", "number", [0, 0, 4, 1], { table: "tbl_chairs", agg: "count", filters: [{ field: "fld_status", op: "eq", value: optId("Rented") }] }, { title: "Chairs rented" }),
        block("blk_free", "number", [4, 0, 4, 1], { table: "tbl_chairs", agg: "count", filters: [{ field: "fld_status", op: "eq", value: optId("Available") }] }, { title: "Chairs free" }),
        block("blk_due_sum", "number", [8, 0, 4, 1], { table: "tbl_rent", agg: "sum", field: "fld_amount", filters: [{ field: "fld_status", op: "neq", value: optId("Paid") }] }, { title: "Rent outstanding" }),
        block("blk_due", "list", [0, 1, 6, 5], { table: "tbl_rent", filters: [{ field: "fld_status", op: "neq", value: optId("Paid") }], sort: [{ field: "fld_due", dir: "asc" }] }, { title: "Rent to collect" }),
        ...(want.has("documents")
          ? [block("blk_expiring", "list", [6, 1, 6, 5], { table: "tbl_documents", filters: [{ field: "fld_expires", op: "lte", value: "@this_month" }], sort: [{ field: "fld_expires", dir: "asc" }] }, { title: "Documents expiring" })]
          : []),
      ]),
      page("pg_chairs", "Chairs", "box", 1, [block("blk_chairs", "board", [0, 0, 12, 5], { table: "tbl_chairs", groupBy: "fld_status" }, { title: "Chairs" })]),
      page("pg_renters", "Renters", "users", 2, [
        block("blk_renters", "table", [0, 0, 8, 6], { table: "tbl_renters", sort: [{ field: "fld_name", dir: "asc" }] }, { title: "Renters" }),
        block("blk_new_renter", "form", [8, 0, 4, 7], { table: "tbl_renters" }, { title: "Add a renter" }),
      ]),
      page("pg_rent", "Rent", "payments", 3, [block("blk_rent", "table", [0, 0, 12, 7], { table: "tbl_rent", sort: [{ field: "fld_due", dir: "desc" }] }, { title: "Rent payments" })]),
    ];
    let order = 4;
    if (want.has("documents")) pages.push(page("pg_documents", "Documents", "documents", order++, [block("blk_documents", "table", [0, 0, 12, 7], { table: "tbl_documents", sort: [{ field: "fld_expires", dir: "asc" }] }, { title: "Documents" })]));
    if (want.has("applicants")) {
      pages.push(
        page("pg_applicants", "Applicants", "inbox", order++, [
          block("blk_applicants", "board", [0, 0, 12, 6], { table: "tbl_applicants", groupBy: "fld_stage" }, { title: "Applicants" }),
        ]),
      );
    }

    const automations: Automation[] = [];
    if (want.has("rent_reminders")) {
      automations.push(
        automation({
          id: "aut_rent_reminder",
          label: "Rent reminder the day before",
          trigger: { type: "date_reached", table: "tbl_rent", field: "fld_due", offset: "-24h" },
          // Checked right before sending: unpaid, and the renter hasn't left.
          conditions: [{ field: "fld_status", op: "neq", value: optId("Paid") }, { field: "fld_renter_status", op: "neq", value: optId("Ended") }],
          actions: [{ type: "send_message", channel: "auto", to: "fld_renter", template: "tpl_rent_due" }],
        }),
      );
    }
    if (want.has("documents")) {
      automations.push(
        automation({
          id: "aut_doc_expiry",
          label: "Document expires in 30 days",
          trigger: { type: "date_reached", table: "tbl_documents", field: "fld_expires", offset: "-30d" },
          conditions: [{ field: "fld_renter_status", op: "neq", value: optId("Ended") }],
          actions: [{ type: "notify", to: "owner" }, { type: "send_message", channel: "auto", to: "fld_renter", template: "tpl_doc_expiry" }],
        }),
      );
    }

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "chair_rental" },
        tables,
        pages,
        automations,
        connections: [{ id: "con_stripe", provider: "stripe", status: "not_connected" }],
        modules: ["payments", "messaging", ...(want.has("documents") ? (["documents"] as const) : [])],
      }),
      seed: list(answers, chairs).map((name) => ({ table: "tbl_chairs", data: { fld_name: name, fld_status: optId("Available") } })),
    };
  },
};
