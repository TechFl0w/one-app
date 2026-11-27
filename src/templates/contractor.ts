import type { Automation, Field, Page, Table } from "@/schema/blueprint";
import { choice, list, multi, type Question, type Seed, type Template } from "./types";
import { isoDate, localToday } from "@/engine/dates";
import { automation, block, check, COLORS, date, email, file, finish, link, longText, money, optId, page, phone, status, text } from "./kit";
import { invoicingTables } from "./invoicing";

/**
 * Trades that quote and invoice: landscapers, electricians, plumbers, builders, cleaners
 * (docs/business-types/contractor.md). Clients and their sites, jobs moving from lead to done,
 * quotes with a scope of work the client accepts online, invoices they pay online.
 */

const trade: Question & { kind: "choice" } = {
  id: "trade",
  kind: "choice",
  label: "What kind of work do you do?",
  options: [
    { id: "landscaping", label: "Landscaping & gardens" },
    { id: "electrical", label: "Electrical" },
    { id: "plumbing", label: "Plumbing & heating" },
    { id: "building", label: "Building & renovation" },
    { id: "other", label: "Something else" },
  ],
  default: "landscaping",
};
const crew: Question & { kind: "list" } = {
  id: "crew",
  kind: "list",
  label: "Who's on your crew?",
  placeholder: "e.g. Alex",
  hint: "You can add more later.",
  max: 30,
  default: ["Alex", "Sam"],
};
const extras: Question & { kind: "multi" } = {
  id: "extras",
  kind: "multi",
  label: "What should it do for you?",
  options: [
    { id: "followup", label: "Remind me to follow up on quotes", hint: "3 days after sending" },
    { id: "reminders", label: "Remind clients of overdue invoices" },
  ],
  default: ["followup", "reminders"],
};
const sample: Question & { kind: "choice" } = {
  id: "sample",
  kind: "choice",
  label: "Start with sample clients, jobs and quotes?",
  options: [
    { id: "yes", label: "Yes, show me how it works", hint: "Delete them any time" },
    { id: "no", label: "No, start empty" },
  ],
  default: "yes",
};

const STAGES: [string, string][] = [
  ["Lead", "#6E685D"],
  ["Site visit", "#2B6CB0"],
  ["Quoting", "#B7791F"],
  ["Won", "#6B46C1"],
  ["Scheduled", "#3B7DC4"],
  ["In progress", "#C2410C"],
  ["Done", "#17694F"],
  ["Lost", "#8A8273"],
];
const S = optId;
const OPEN = { field: "fld_j_stage", op: "neq" as const, value: S("Lost") };
const rollup = (f: Omit<Extract<Field, { type: "rollup" }>, "type">): Field => ({ type: "rollup", ...f }) as Field;
const recordPage = (id: string, label: string, table: string, blocks: Page["layout"]["blocks"]): Page => ({ id, label, menuOrder: 99, hidden: true, recordOf: table, layout: { columns: 12, blocks } });

export const contractor: Template = {
  id: "contractor",
  label: "Quote & invoice jobs",
  description: "Landscapers, electricians, plumbers, builders: clients and sites, jobs, quotes clients accept online, invoices they pay online.",
  businessType: "contractor",
  questions: [trade, crew, extras, sample],
  build(business, answers) {
    const kind = choice(answers, trade);
    const want = new Set(multi(answers, extras));
    const inv = invoicingTables({
      customers: "tbl_clients",
      links: [{ table: "tbl_jobs", label: "Job", id: "job" }, { table: "tbl_sites", label: "Site", id: "site" }],
      quoteTerms: "Valid for 30 days. A 50% deposit books the work; the balance is due on completion.",
      invoiceTerms: "Payment due within 14 days. Thank you for your business!",
    });
    const tables: Table[] = [
      {
        id: "tbl_clients",
        label: "Clients",
        primaryField: "fld_c_name",
        fields: [
          text("fld_c_name", "Name", true),
          phone("fld_c_phone"),
          email("fld_c_email"),
          longText("fld_c_address", "Billing address"),
          longText("fld_c_notes", "Notes"),
          rollup({ id: "fld_c_jobs", label: "Open jobs", from: "tbl_jobs", via: "fld_j_client", field: "fld_j_title", agg: "count", where: [OPEN, { field: "fld_j_stage", op: "neq", value: S("Done") }] }),
          rollup({ id: "fld_c_owed", label: "Owes", from: "tbl_invoices", via: "fld_i_client", field: "fld_i_balance", agg: "sum", format: "money" }),
        ],
      },
      {
        id: "tbl_sites",
        label: "Sites",
        primaryField: "fld_s_address",
        fields: [
          text("fld_s_address", "Address", true),
          link("fld_s_client", "Client", "tbl_clients", { required: true }),
          { ...file("fld_s_photos", "Photos"), multiple: true } as Field,
          longText("fld_s_access", "Access notes"),
          rollup({ id: "fld_s_jobs", label: "Jobs", from: "tbl_jobs", via: "fld_j_site", field: "fld_j_title", agg: "count" }),
        ],
      },
      {
        id: "tbl_crew",
        label: "Crew",
        primaryField: "fld_cr_name",
        fields: [text("fld_cr_name", "Name", true), phone("fld_cr_phone"), money("fld_cr_rate", "Hourly rate"), check("fld_cr_active", "Active")],
      },
      {
        id: "tbl_jobs",
        label: "Jobs",
        primaryField: "fld_j_title",
        fields: [
          text("fld_j_title", "Job", true),
          link("fld_j_client", "Client", "tbl_clients", { required: true }),
          link("fld_j_site", "Site", "tbl_sites"),
          status("fld_j_stage", "Stage", STAGES),
          date("fld_j_start", "Starts"),
          date("fld_j_end", "Finishes"),
          link("fld_j_crew", "Crew", "tbl_crew", { multiple: true }),
          { ...file("fld_j_photos", "Photos (before & after)"), multiple: true } as Field,
          longText("fld_j_notes", "Notes"),
          rollup({ id: "fld_j_quoted", label: "Quoted", from: "tbl_quotes", via: "fld_q_job", field: "fld_q_total", agg: "sum", where: [{ field: "fld_q_status", op: "neq", value: S("Declined") }], format: "money" }),
          rollup({ id: "fld_j_won", label: "Accepted", from: "tbl_quotes", via: "fld_q_job", field: "fld_q_total", agg: "sum", where: [{ field: "fld_q_status", op: "eq", value: S("Accepted") }], format: "money" }),
          rollup({ id: "fld_j_invoiced", label: "Invoiced", from: "tbl_invoices", via: "fld_i_job", field: "fld_i_total", agg: "sum", format: "money" }),
          rollup({ id: "fld_j_owed", label: "Owed", from: "tbl_invoices", via: "fld_i_job", field: "fld_i_balance", agg: "sum", format: "money" }),
        ],
      },
      ...inv.tables,
    ];

    const quoteStatus = (label: string) => ({ field: "fld_q_status", op: "eq" as const, value: S(label) });
    const invStatus = (label: string) => ({ field: "fld_i_status", op: "eq" as const, value: S(label) });
    const pages: Page[] = [
      page("pg_today", "Today", "sun", 0, [
        block("blk_t_hello", "header", [0, 0, 12, 2], undefined, {
          stats: [
            { table: "tbl_jobs", filters: [{ field: "fld_j_stage", op: "eq", value: S("In progress") }], label: "job on the go|jobs on the go" },
            { table: "tbl_quotes", filters: [quoteStatus("Sent")], label: "quote waiting|quotes waiting" },
            { table: "tbl_invoices", agg: "sum", field: "fld_i_balance", filters: [invStatus("Overdue")], label: "overdue", tone: "red" },
          ],
          add: ["tbl_jobs", "tbl_quotes"],
        }),
        block("blk_t_week", "number", [0, 2, 3, 2], { table: "tbl_jobs", agg: "count", filters: [{ field: "fld_j_start", op: "eq", value: "@this_week" }] }, { title: "Starting this week", icon: "calendar", tone: "blue", sub: "Jobs on the schedule", page: "pg_schedule" }),
        block("blk_t_quotes", "number", [3, 2, 3, 2], { table: "tbl_quotes", agg: "sum", field: "fld_q_total", filters: [quoteStatus("Sent")] }, { title: "Quotes out", icon: "documents", tone: "amber", sub: "Waiting for the client's yes", page: "pg_quotes" }),
        block("blk_t_won", "number", [6, 2, 3, 2], { table: "tbl_quotes", agg: "sum", field: "fld_q_total", filters: [{ field: "fld_q_accepted", op: "eq", value: "@this_month" }] }, { title: "Won this month", icon: "check", tone: "accent", sub: "Accepted quotes", page: "pg_quotes" }),
        block("blk_t_overdue", "number", [9, 2, 3, 2], { table: "tbl_invoices", agg: "sum", field: "fld_i_balance", filters: [invStatus("Overdue")] }, { title: "Overdue", icon: "alert", tone: "red", alert: true, sub: "Invoices past their due date", page: "pg_invoices" }),
        block("blk_t_starting", "list", [0, 4, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_start", op: "eq", value: "@this_week" }], sort: [{ field: "fld_j_start", dir: "asc" }] }, { title: "Starting this week", fields: ["fld_j_site", "fld_j_client", "fld_j_start", "fld_j_stage"] }),
        block("blk_t_waiting", "list", [6, 4, 6, 3], { table: "tbl_quotes", filters: [quoteStatus("Sent")], sort: [{ field: "fld_q_sent", dir: "asc" }] }, { title: "Quotes waiting for an answer", tone: "amber", fields: ["fld_q_client", "fld_q_total", "fld_q_sent", "fld_q_valid"] }),
        block("blk_t_overdue_list", "list", [0, 7, 6, 3], { table: "tbl_invoices", filters: [invStatus("Overdue")], sort: [{ field: "fld_i_due", dir: "asc" }] }, { title: "Overdue — chase payment", tone: "red", fields: ["fld_i_client", "fld_i_balance", "fld_i_due"] }),
        block("blk_t_toinvoice", "list", [6, 7, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_stage", op: "eq", value: S("Done") }, { field: "fld_j_invoiced", op: "lte", value: 0 }] }, { title: "Done — ready to invoice", tone: "accent", fields: ["fld_j_client", "fld_j_won"] }),
      ]),
      page("pg_jobs", "Jobs", "tools", 1, [
        block("blk_j_board", "board", [0, 0, 12, 7], { table: "tbl_jobs", groupBy: "fld_j_stage", sort: [{ field: "fld_j_start", dir: "asc" }] }, { title: "Drag a job to its next stage, or tap the button", nextButton: true, fields: ["fld_j_client", "fld_j_site", "fld_j_start", "fld_j_quoted"] }),
      ]),
      page("pg_schedule", "Schedule", "calendar", 2, [
        block("blk_cal", "calendar", [0, 0, 12, 8], { table: "tbl_jobs", field: "fld_j_start" }, { title: "Job start dates", view: "week" }),
      ]),
      page("pg_quotes", "Quotes", "documents", 3, [
        block("blk_q_table", "table", [0, 0, 12, 8], { table: "tbl_quotes", sort: [{ field: "_created_at", dir: "desc" }] }, { title: "Quotes", columns: ["fld_q_number", "fld_q_title", "fld_q_client", "fld_q_status", "fld_q_total", "fld_q_sent", "fld_q_valid"] }),
      ]),
      page("pg_invoices", "Invoices", "payments", 4, [
        block("blk_i_table", "table", [0, 0, 12, 6], { table: "tbl_invoices", sort: [{ field: "_created_at", dir: "desc" }] }, { title: "Invoices", columns: ["fld_i_number", "fld_i_title", "fld_i_client", "fld_i_status", "fld_i_total", "fld_i_balance", "fld_i_due"] }),
        block("blk_i_payments", "table", [0, 6, 12, 4], { table: "tbl_payments", sort: [{ field: "fld_pay_on", dir: "desc" }] }, { title: "Payments received", columns: ["fld_pay_title", "fld_pay_invoice", "fld_pay_amount", "fld_pay_method", "fld_pay_on"] }),
      ]),
      page("pg_clients", "Clients", "users", 5, [
        block("blk_c_table", "table", [0, 0, 12, 8], { table: "tbl_clients", sort: [{ field: "fld_c_name", dir: "asc" }] }, { title: "Clients", columns: ["fld_c_name", "fld_c_phone", "fld_c_email", "fld_c_jobs", "fld_c_owed"] }),
      ]),
      page("pg_sites", "Sites", "home", 6, [
        block("blk_s_gallery", "gallery", [0, 0, 12, 6], { table: "tbl_sites", sort: [{ field: "fld_s_address", dir: "asc" }] }, { title: "Sites", fields: ["fld_s_client", "fld_s_jobs"] }),
      ]),
      page("pg_crew", "Crew", "team", 7, [block("blk_crew", "table", [0, 0, 12, 5], { table: "tbl_crew", sort: [{ field: "fld_cr_name", dir: "asc" }] }, { title: "Crew" })]),

      recordPage("pg_r_job", "Job", "tbl_jobs", [
        block("blk_rj_hero", "details", [0, 0, 12, 3], { table: "tbl_jobs" }, { part: "hero" }),
        block("blk_rj_quotes", "table", [0, 3, 8, 3], { table: "tbl_quotes", filters: [{ field: "fld_q_job", op: "eq", value: "@record" }] }, { title: "Quotes", columns: ["fld_q_number", "fld_q_title", "fld_q_status", "fld_q_total"] }),
        block("blk_rj_facts", "details", [8, 3, 4, 6], { table: "tbl_jobs" }, { part: "facts" }),
        block("blk_rj_invoices", "table", [0, 6, 8, 3], { table: "tbl_invoices", filters: [{ field: "fld_i_job", op: "eq", value: "@record" }] }, { title: "Invoices", columns: ["fld_i_number", "fld_i_title", "fld_i_status", "fld_i_total", "fld_i_balance"] }),
        block("blk_rj_photos", "details", [0, 9, 8, 3], { table: "tbl_jobs" }, { part: "photos" }),
        block("blk_rj_activity", "activity", [8, 9, 4, 3], { table: "tbl_jobs" }),
      ]),
      recordPage("pg_r_quote", "Quote", "tbl_quotes", [
        block("blk_rq_doc", "document", [0, 0, 8, 9], { table: "tbl_quotes" }),
        block("blk_rq_lines", "table", [8, 0, 4, 4], { table: "tbl_quote_lines", filters: [{ field: "fld_ql_parent", op: "eq", value: "@record" }], sort: [{ field: "_created_at", dir: "asc" }] }, { title: "Lines — add or change", columns: ["fld_ql_desc", "fld_ql_qty", "fld_ql_total"] }),
        block("blk_rq_facts", "details", [8, 4, 4, 3], { table: "tbl_quotes" }, { part: "facts", title: "Quote details" }),
        block("blk_rq_activity", "activity", [8, 7, 4, 2], { table: "tbl_quotes" }),
      ]),
      recordPage("pg_r_invoice", "Invoice", "tbl_invoices", [
        block("blk_ri_doc", "document", [0, 0, 8, 9], { table: "tbl_invoices" }),
        block("blk_ri_lines", "table", [8, 0, 4, 3], { table: "tbl_invoice_lines", filters: [{ field: "fld_il_parent", op: "eq", value: "@record" }], sort: [{ field: "_created_at", dir: "asc" }] }, { title: "Lines — add or change", columns: ["fld_il_desc", "fld_il_qty", "fld_il_total"] }),
        block("blk_ri_payments", "table", [8, 3, 4, 3], { table: "tbl_payments", filters: [{ field: "fld_pay_invoice", op: "eq", value: "@record" }], sort: [{ field: "fld_pay_on", dir: "desc" }] }, { title: "Payments", columns: ["fld_pay_amount", "fld_pay_method", "fld_pay_on"] }),
        block("blk_ri_facts", "details", [8, 6, 4, 3], { table: "tbl_invoices" }, { part: "facts", title: "Invoice details" }),
      ]),
      recordPage("pg_r_client", "Client", "tbl_clients", [
        block("blk_rc_details", "details", [0, 0, 5, 5], { table: "tbl_clients" }),
        block("blk_rc_sites", "list", [5, 0, 7, 2], { table: "tbl_sites", filters: [{ field: "fld_s_client", op: "eq", value: "@record" }] }, { title: "Sites", fields: ["fld_s_jobs"] }),
        block("blk_rc_jobs", "table", [5, 2, 7, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_client", op: "eq", value: "@record" }], sort: [{ field: "fld_j_start", dir: "desc" }] }, { title: "Jobs", columns: ["fld_j_title", "fld_j_stage", "fld_j_start", "fld_j_owed"] }),
        block("blk_rc_invoices", "table", [0, 5, 12, 3], { table: "tbl_invoices", filters: [{ field: "fld_i_client", op: "eq", value: "@record" }], sort: [{ field: "_created_at", dir: "desc" }] }, { title: "Invoices", columns: ["fld_i_number", "fld_i_title", "fld_i_status", "fld_i_total", "fld_i_balance"] }),
      ]),
      recordPage("pg_r_site", "Site", "tbl_sites", [
        block("blk_rs_hero", "details", [0, 0, 12, 3], { table: "tbl_sites" }, { part: "hero" }),
        block("blk_rs_photos", "details", [0, 3, 6, 3], { table: "tbl_sites" }, { part: "photos" }),
        block("blk_rs_jobs", "table", [6, 3, 6, 3], { table: "tbl_jobs", filters: [{ field: "fld_j_site", op: "eq", value: "@record" }], sort: [{ field: "fld_j_start", dir: "desc" }] }, { title: "Jobs here", columns: ["fld_j_title", "fld_j_stage", "fld_j_start"] }),
      ]),
    ];
    const badges: Record<string, NonNullable<Page["badge"]>> = {
      pg_jobs: { source: { table: "tbl_jobs", filters: [{ field: "fld_j_stage", op: "eq", value: S("In progress") }] }, label: "on", tone: "accent" },
      pg_quotes: { source: { table: "tbl_quotes", filters: [quoteStatus("Sent")] }, label: "out", tone: "amber" },
      pg_invoices: { source: { table: "tbl_invoices", filters: [invStatus("Overdue")] }, label: "overdue", tone: "red" },
    };
    for (const p of pages) if (badges[p.id]) p.badge = badges[p.id];

    // Conditions are checked again right before acting (docs/data-rules.md).
    const automations: Automation[] = [];
    if (want.has("followup"))
      automations.push(
        automation({
          id: "aut_quote_followup",
          label: "Follow up on quotes 3 days after sending",
          trigger: { type: "date_reached", table: "tbl_quotes", field: "fld_q_sent", offset: "+3d" },
          conditions: [quoteStatus("Sent")],
          actions: [{ type: "notify", message: "No answer yet on quote {{fld_q_number}} ({{fld_q_title}}) — give the client a call?" }],
        }),
      );
    if (want.has("reminders"))
      automations.push(
        automation({
          id: "aut_invoice_reminder",
          label: "Remind clients the day after an invoice is due",
          trigger: { type: "date_reached", table: "tbl_invoices", field: "fld_i_due", offset: "+1d" },
          conditions: [invStatus("Overdue")],
          actions: [{ type: "send_message", channel: "auto", to: "fld_i_client", message: "A friendly reminder: invoice {{fld_i_number}} ({{fld_i_title}}) was due yesterday. Thank you!" }],
        }),
      );
    // An accepted quote wins the job: the board moves by itself (only from the stages before Won).
    automations.push(
      automation({
        id: "aut_quote_won",
        label: "Move the job to Won when its quote is accepted",
        trigger: { type: "record_updated", table: "tbl_quotes", field: "fld_q_accepted" },
        conditions: [{ field: "fld_q_accepted", op: "not_empty" }, { field: "fld_q_job", op: "not_empty" }],
        actions: [{ type: "update_record", via: "fld_q_job", values: { fld_j_stage: S("Won") } }],
      }),
    );
    automations.push(
      automation({
        id: "aut_quote_accepted",
        label: "Tell me when a client accepts a quote",
        trigger: { type: "date_reached", table: "tbl_quotes", field: "fld_q_accepted", offset: "+0d" },
        conditions: [quoteStatus("Accepted")],
        actions: [{ type: "notify", message: "Quote {{fld_q_number}} ({{fld_q_title}}) was accepted by {{fld_q_accepted_by}}." }],
      }),
    );

    const seed: Seed[] = list(answers, crew).map((name, i) => ({ table: "tbl_crew", ref: `crew${i}`, data: { fld_cr_name: name, fld_cr_active: true } }));
    if (choice(answers, sample) === "yes") seed.push(...sampleData(isoDate(localToday(new Date(), business.timezone)), kind, seed.length > 0));

    return {
      blueprint: finish({
        version: 1,
        business: { ...business, type: "contractor" },
        tables,
        pages,
        automations,
        connections: [{ id: "con_stripe", provider: "stripe", status: "not_connected" }],
        modules: ["payments", "messaging"],
        documents: inv.documents,
      }),
      seed,
    };
  },
};

type Line = [desc: string, kind: string, qty: number, unit: string, price: number];
const WORK: Record<string, { big: [string, string, Line[]]; small: [string, Line[]]; lead: string }> = {
  landscaping: {
    big: ["Backyard makeover", "Clear the back garden, level and lay new sod, build three cedar planters along the fence and add one irrigation zone. Green waste removed from site.", [
      ["Site prep, clearing and levelling", "Labour", 16, "hr", 65],
      ["Premium sod, supplied and laid", "Materials", 120, "m²", 6.5],
      ["Cedar planter boxes, 2.4 m", "Materials", 3, "each", 240],
      ["Irrigation zone with timer", "Equipment", 1, "job", 850],
      ["Green waste disposal", "Other", 1, "job", 180],
    ]],
    small: ["Spring cleanup", [["Spring cleanup, 2 gardeners", "Labour", 6, "hr", 65], ["Mulch, 3 yards", "Materials", 3, "each", 55]]],
    lead: "Retaining wall at the front",
  },
  electrical: {
    big: ["Panel upgrade to 200 A", "Replace the 100 A panel with a 200 A panel, move existing circuits, add surge protection, arrange permit and inspection.", [
      ["200 A panel, breakers and surge protector", "Materials", 1, "each", 1450],
      ["Licensed electrician", "Labour", 10, "hr", 110],
      ["Permit and inspection", "Other", 1, "job", 260],
    ]],
    small: ["EV charger install", [["Level 2 charger circuit, 40 A", "Labour", 4, "hr", 110], ["Wire, breaker and conduit", "Materials", 1, "job", 320]]],
    lead: "Kitchen pot lights",
  },
  plumbing: {
    big: ["Bathroom rough-in", "Rough-in plumbing for the new bathroom: supply lines, drains and venting, ready for inspection.", [
      ["Plumber and apprentice", "Labour", 14, "hr", 105],
      ["PEX, fittings and drain parts", "Materials", 1, "job", 980],
      ["Permit", "Other", 1, "job", 190],
    ]],
    small: ["Water heater replacement", [["50 gal water heater", "Materials", 1, "each", 1150], ["Install and haul away old unit", "Labour", 3, "hr", 105]]],
    lead: "Leaking shower valve",
  },
  building: {
    big: ["Deck rebuild", "Remove the old deck, build a new 4 × 5 m pressure-treated deck with stairs and railing.", [
      ["Demolition and disposal", "Labour", 8, "hr", 70],
      ["Framing, decking and railing", "Labour", 40, "hr", 70],
      ["Lumber and hardware", "Materials", 1, "job", 3200],
    ]],
    small: ["Drywall repair", [["Patch and paint 3 walls", "Labour", 6, "hr", 70], ["Drywall, mud and paint", "Materials", 1, "job", 140]]],
    lead: "Basement finishing",
  },
};

/** Sample work for the trade, dated around today: a quote waiting, one accepted and invoiced, one overdue. */
function sampleData(today: string, kind: string, hasCrew: boolean): Seed[] {
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const w = WORK[kind] ?? WORK.landscaping;
  const crew = hasCrew ? { fld_j_crew: ["@ref:crew0"] } : {};
  const lines = (p: string, parent: string, ls: Line[]): Seed[] =>
    ls.map(([desc, k, qty, unit, price]) => ({ table: p === "ql" ? "tbl_quote_lines" : "tbl_invoice_lines", data: { [`fld_${p}_desc`]: desc, [`fld_${p}_parent`]: `@ref:${parent}`, [`fld_${p}_kind`]: S(k), [`fld_${p}_qty`]: qty, [`fld_${p}_unit`]: S(unit), [`fld_${p}_price`]: price } }));
  return [
    { table: "tbl_clients", ref: "priya", data: { fld_c_name: "Priya Shah", fld_c_phone: "+1 604 555 0123", fld_c_email: "priya@example.com", fld_c_address: "14 Maple Crescent\nVancouver BC" } },
    { table: "tbl_clients", ref: "tom", data: { fld_c_name: "Tom Becker", fld_c_phone: "+1 604 555 0188", fld_c_email: "tom@example.com" } },
    { table: "tbl_clients", ref: "ana", data: { fld_c_name: "Ana Lima", fld_c_email: "ana@example.com" } },
    { table: "tbl_sites", ref: "maple", data: { fld_s_address: "14 Maple Crescent", fld_s_client: "@ref:priya", fld_s_access: "Side gate code 4411. Dog is friendly." } },
    { table: "tbl_sites", ref: "oak", data: { fld_s_address: "209 Oak Street", fld_s_client: "@ref:tom" } },
    { table: "tbl_sites", ref: "birch", data: { fld_s_address: "77 Birch Lane", fld_s_client: "@ref:ana" } },
    { table: "tbl_jobs", ref: "big", data: { fld_j_title: w.big[0], fld_j_client: "@ref:priya", fld_j_site: "@ref:maple", fld_j_stage: S("Quoting"), fld_j_start: day(9), fld_j_end: day(12) } },
    { table: "tbl_jobs", ref: "small", data: { fld_j_title: w.small[0], fld_j_client: "@ref:tom", fld_j_site: "@ref:oak", fld_j_stage: S("Done"), fld_j_start: day(-20), fld_j_end: day(-20), ...crew } },
    { table: "tbl_jobs", ref: "now", data: { fld_j_title: `${w.small[0]} (2nd visit)`, fld_j_client: "@ref:ana", fld_j_site: "@ref:birch", fld_j_stage: S("In progress"), fld_j_start: day(0), fld_j_end: day(1), ...crew } },
    { table: "tbl_jobs", data: { fld_j_title: w.lead, fld_j_client: "@ref:tom", fld_j_site: "@ref:oak", fld_j_stage: S("Lead") } },
    // A quote out with the client, waiting for their answer.
    { table: "tbl_quotes", ref: "q1", data: { fld_q_title: w.big[0], fld_q_number: "Q-0001", fld_q_client: "@ref:priya", fld_q_job: "@ref:big", fld_q_site: "@ref:maple", fld_q_scope: w.big[1], fld_q_valid: day(26), fld_q_tax_rate: 5, fld_q_sent: day(-4) } },
    ...lines("ql", "q1", w.big[2]),
    // Accepted and invoiced weeks ago — the invoice is overdue.
    { table: "tbl_quotes", ref: "q2", data: { fld_q_title: w.small[0], fld_q_number: "Q-0002", fld_q_client: "@ref:tom", fld_q_job: "@ref:small", fld_q_site: "@ref:oak", fld_q_valid: day(10), fld_q_tax_rate: 5, fld_q_sent: day(-25), fld_q_accepted: day(-24), fld_q_accepted_by: "Tom Becker" } },
    ...lines("ql", "q2", w.small[1]),
    { table: "tbl_invoices", ref: "i1", data: { fld_i_title: w.small[0], fld_i_number: "INV-0001", fld_i_client: "@ref:tom", fld_i_job: "@ref:small", fld_i_site: "@ref:oak", fld_i_quote: "@ref:q2", fld_i_issued: day(-19), fld_i_due: day(-5), fld_i_sent: day(-19), fld_i_tax_rate: 5 } },
    ...lines("il", "i1", w.small[1]),
    { table: "tbl_payments", data: { fld_pay_title: "Deposit", fld_pay_invoice: "@ref:i1", fld_pay_amount: 100, fld_pay_method: S("E-transfer"), fld_pay_on: day(-18) } },
  ];
}
