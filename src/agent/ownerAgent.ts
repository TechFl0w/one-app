import Anthropic from "@anthropic-ai/sdk";
import type { Blueprint } from "@/schema/blueprint";
import { menuOrder } from "@/engine/editing";
import { localToday, isoDate } from "@/engine/dates";
import { KIT_DTS } from "@/codegen/kitTypes";
import { checkStandards } from "@/codegen/standards";
import { checkDataRules } from "@/engine/dataRules";
import { SERVER_KIT_DTS } from "@/codegen/serverKitTypes";
import { executeOwnerTool, OWNER_TOOLS, ownerToolDefinitions, type ToolEffects } from "./ownerTools";
import type { AgentResponse, OwnerBackend, PendingAction } from "./types";
import { aiModelInfo, defaultAiModel, resolveAiModel } from "./models";

/**
 * The owner agent: a manual tool-use loop over OWNER_TOOLS. Who is talking is decided by the
 * caller before this runs (CLAUDE.md rule 5); this agent only ever gets owner tools.
 */

/** Default model; a business can choose another in Settings (see ./models). */
export const OWNER_MODEL = defaultAiModel();
export interface TurnUsage {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}
export function usageCost(u: Omit<TurnUsage, "costUsd" | "requests">) {
  const [i, o, r, w] = aiModelInfo(u.model).prices;
  return (u.inputTokens * i + u.outputTokens * o + u.cacheReadTokens * r + u.cacheWriteTokens * w) / 1_000_000;
}
const MAX_STEPS = 16;
/** Stop before the server action’s limit (300s); a build plan carries on in the next turn. */
const TURN_BUDGET_MS = 230_000;
const MAX_RESULT_CHARS = 12_000;

export type Message = Anthropic.Beta.BetaMessageParam;
export type ModelCall = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

/** Default model call: Opus 5.5 with server-side refusal fallback. */
export function anthropicModel(client = new Anthropic()): ModelCall {
  return (params) => client.beta.messages.create(params);
}

const CHAT_INTRO = `You are the assistant inside One App, a business-management app for a small business. You talk with the owner.

You can read and change their data (records) and their setup (tables, fields, pages, blocks, automations) with your tools. Everything you change shows up in their app right away.

How to work:
- Use the latest "Current setup" note in the conversation for ids (it is updated after setup changes). Refer to things by their labels when you talk to the owner; never show ids, JSON or tool names.
- Prefer doing over explaining: when the owner asks for a change, make it, then say in one or two sentences what changed.
- Setup changes go through change_setup in one call per request. Keep labels short and in the owner's language.
- Removing data, changing prices or amounts, and changing automations wait for the owner's confirmation. When a tool tells you it is waiting, say in one or two plain sentences what will happen and that they can confirm below. Never claim it is done.
- In a new business's first two days (setting up), setup changes — automations and booking settings included — apply straight away; only deleting tables or fields waits. Before building a whole app, tell the owner the plan in plain words (what they'll be able to do, not tables and fields) in a few lines, then build it in one go.
- If more work depends on something waiting for confirmation, record the remaining steps with plan_build in the same turn: the app carries on by itself once the owner confirms. Never ask the owner to come back and tell you after confirming.
- If a request is unclear, ask one short question with concrete options.
- Keep replies short and warm. Plain sentences; a short list only when listing records. Markdown (bold, lists) is shown formatted.
- Talk like a helpful colleague, not an engineer: no technical words (server code, function, component, automation trigger, webhook, API, field, rollup, formula, database, code). Say what the owner will notice ("Rooms will now show when they have an open repair, and it stays up to date by itself"). Don't explain how it works unless they ask.
`;

const CHAT_RENDER_CHECK = `- After you write a component, the app sends you an "[Automatic check]" message with a picture of how it actually renders (and the owner's design, if there was one). Compare carefully: layout, spacing, colours, sizes, missing or broken parts, empty states. If it's right, reply in one short sentence. If not, fix it with write_component (same id) — don't explain at length. The picture uses fallback fonts; ignore font differences.\n`;
const CHAT_STEP4 = "4. The automatic check shows your screen next to the screenshots: fix differences before moving on. Keep replies to one or two sentences while building.\n";
const MCP_RENDER_CHECK = "- No picture comes back over this connection. After writing a component, check it yourself if you can (open the page in a browser or ask the owner for a screenshot) and fix layout, spacing, empty states and broken parts with write_component (same id).\n";
const MCP_STEP4 = "4. Check each screen against its screenshot before moving on (see above).\n";

/**
 * How to build in One App: custom UI, the app rules, recreating from screenshots, the kits.
 * The in-app chat gets an automatic render check; MCP clients (Claude Code, Claude.ai…) don't.
 */
export function buildGuide(opts: { renderCheck: boolean }): string {
  const renderCheck = opts.renderCheck ? CHAT_RENDER_CHECK : MCP_RENDER_CHECK;
  const step4 = opts.renderCheck ? CHAT_STEP4 : MCP_STEP4;
  return `Custom UI (write_component):
- Standard blocks (header, number, list, gallery, board, table, calendar, form, notes) are quickest and look the part — use them generously:
  - header (w 12, top of a dashboard): greeting, today's date, a live line options.stats [{ table, filters?, agg?, field?, label: "car in the shop|cars in the shop", tone? }] and New buttons options.add [table ids].
  - number = a KPI tile: options { title, icon (car, clock, check, alert, money, calendar, users, box…), tone (accent | red | amber | blue | purple | neutral), sub (a short line under the number), alert: true (only stands out while not zero), page (page id it links to) }. Four in a row (w 3).
  - list rows and board / gallery cards lead with the table's photo (first file field, or options.cover; cover: false to hide). list options.tone colours the rows (red for "late", amber for "to reorder"). Boards colour each column by its option colour; for a pipeline (stages in order) set options.nextButton: true so cards get a one-tap "→ next stage" button.
  - Record pages: a "details" block with options.part "hero" (photo, title, badges, a stage stepper for the stage field), "facts" (the remaining values) and "photos" (photo/video fields, add straight in); an "activity" block (source: { table }) shows the record's timeline. A table of child records can carry one-tap buttons: options.quickSet { field, buttons: [{ value: option id, label: "Approve" }, …] }; on a date field use value "@today" ("Paid today", shown while the date is empty), and "also": { fld_method: "opt_card" } sets more fields at once.
  - gallery options.colorBy (a status, or a rollup of one) fills each card with that colour, empty ones show as "Free" — a map of bays, rooms or chairs.
  - Booking for a pet, car or child (groomers, mechanics, kids' classes): setScheduling with for { table (pets), booking (the booking's link to it), client (its link to the owner), name, kind? (a size choice), ask? [breed, notes…], label?: "pet" }. Prices and times by size: variants { table (one row per service and size), service, kind (a choice with the same labels as for.kind), duration, price? }. Rules before booking: requirements [{ on: "for" | "client", field, rule: "checked" | "filled" | "valid_on_date", label: "Rabies vaccine valid on the day" }]: the booking page asks for what's missing (files are listed as "please bring"). Services can have category (a choice, groups the booking page), photo and description; staff a photo. The business's address, phone, logo and cover (updateBusiness) show on the booking page and website.
- Online booking: setScheduling turns it on, and the business then has a public booking page (service → staff or "anyone" → free time → details → deposit) in its own theme, at the link get_setup shows. After setting bookings up, give the owner that link and say they can share it on Instagram, Google or their website (Settings › Booking has the link, an on/off switch and an embed snippet). Don't build a booking page as a component: the kit can't see free times, so it would double-book.
  - Quotes and invoices: set up with change_setup setDocument (docs/documents.md) on a table with a client link, lines table and totals; statuses derive from sent/accepted/declined dates and payments. Put a "document" block (source: { table }) on its record page: the owner sends it (email + link), the client accepts or pays online at the link, an accepted quote becomes an invoice in one tap. Businesses that bill by the visit or month (cleaners, maintenance, dog walkers): give the invoice document bill { table (visits), customer (their client link), date, description?, amount, invoice (a link field on visits to the invoice), done? [status eq Done] } — then invoice_work (or "Invoice work" on the client's page) puts a period's finished, unbilled visits on one invoice. Rates: a "Rates" table (name, per hour) with line price fill { from: rate link, field: per hour } so labour lines pick a rate; staff get a charge rate and a pay rate, and hours worked copy both (fill) so each job shows its margin.
  - page.badge { source: { table, filters }, label?, tone? } puts a live count next to the page in the menu ("4", "1 late").
- Pick option colours that read as a sequence for stages (blue → amber → purple → green when done), red/amber only for problems. When the owner wants something they can't do — collapsible or tabbed sections, a different look, combined views, a custom page or flow — write a component instead of saying no.
- A component is one TSX module: \`export default function Name() { … }\`. Import only from "react" and "@one/kit" (API below). Style with Tailwind classes; theme colors: bg-ground, bg-card, text-ink, text-muted, border-line, bg-accent, text-accent, bg-accent-tint, shadow-soft, rounded-2xl. Use the kit's Card, Collapsible, Tabs, Select and DateTimeInput instead of building inputs; never use <select>, native date inputs or hand-made dropdowns/popovers.
- Design quality matters as much as working code. Aim for a modern product look (think Linear, Stripe, Notion, Cal.com): clear typography hierarchy (one big title, small muted labels), generous whitespace, content aligned to a grid, subtle dividers instead of boxes inside boxes, at most one card level, one accent colour used sparingly, real empty states. Avoid a page that is just a stack of equal bordered boxes.
- When the owner asks to change how a page looks or flows ("make it better", "all on one screen", "less boxy"), rebuild the page as ONE full-width component (replaceBlocks with all its blocks, w 12) rather than tweaking block positions.
- Lay out with flex/grid and responsive classes (sm:, md:, lg:) so it works on phones too.
- Read and write data only through the kit with table and field ids from the current setup. Deleting goes through records.remove (the owner confirms in the app).
- To replace standard blocks with a component, pass replaceBlocks. To change an existing component, read_component first, then write_component with the same id.
- If write_component returns compile errors, fix them and call it again before replying.
${renderCheck}- When the owner shares a design (screenshot, mockup, photo of a sketch) and wants the app to look like it: match it. First change_setup with setTheme (colours as hex, the closest font from the allowed list, corner radius, squareButtons, and menu: "side" | "top" | "minimal" to match where the design puts navigation), then rebuild the pages they mean as components that follow the layout — use replaceBlocks or newPage. Say briefly what you matched and what you couldn't.

App rules — every screen you build follows these unless the owner asks otherwise:
- Add and edit happen in a modal: an "Add …" / "New …" button calls openRecordForm({ table, fields, defaults }); an edit action calls openRecordForm({ table, recordId }). Never put an add form permanently on a page or navigate to a separate add page. Use RecordForm inline only when the design itself shows the form on the page.
- Pass fields in a sensible order (name/title first, required fields early, at most ~8). Prefill defaults from context (the client, room or date you're looking at).
- Every record the owner sees can be opened, changed and deleted: openRecordForm({ table, recordId }) gives edit + Delete (and asks before amount changes) — don't build your own delete or confirm flows. Counts in text use plural().
- Every record has its own page (/r/<table>/<id>) with its details and everything linked to it — a car's jobs, a job's lines and payments. Clicking a row or card opens it: openRecord(table, id) in components (standard blocks do it by themselves). Edit stays a pop-up (openRecordForm with recordId). Small child records (invoice lines, payments) can open as a pop-up instead: set the table's openIn: "modal". Every button does something real — no dead buttons, no placeholder links.
- Record pages: every table has a default one (details + a list of each kind of linked record). Design one with change_setup addPage { recordOf: "<table>", hidden: true, … }: a "details" block (source: { table }) shows the record; other blocks use the filter value "@record" for "linked to this record" (e.g. jobs where fld_vehicle eq @record), and their Add button links the new record automatically; a component placed there gets useProps().recordId.
- Boards (kanban): cards can always be dragged between columns. In components use the kit's Board (never hand-made columns); the standard board block does it too. A board grouped by a status that follows dates can't be dragged — group by a stored stage instead.
- Lists: a search box when there can be more than ~10 items, sensible default sort (upcoming first for dates, newest first otherwise), a friendly empty state with the add button, and a Spinner while loading.
- Status and choice values show as Badge with the option's colour (from useSchema), never raw ids. Money with formatMoney, dates with formatDate, linked records with recordLabel.
- Numbers, totals and counts come from real records (useRecords), never hardcoded. Sample data goes into records with create_record, not into the code.
- Deleting always goes through records.remove (the owner confirms). Changes show feedback (toast) and lists refresh by themselves.
- Primary action top right of the screen; one primary button per screen. Destructive actions are secondary and red.
- Business rules live in the data, not in screen code: a value that follows from other records (a room's status from its tenant, a flag for open maintenance, a copied rent status, totals) is a rollup field (addField with type "rollup"), or an automation, set up with change_setup. Rollups are computed whenever records are read, so they're never out of date: { type: "rollup", from: "<child table>", via: "<child's link field to this table>", field, agg: "count" | "sum" | "avg" | "min" | "max" | "latest", where?: [{ field, op, value }] (dates may be "@today"), sortBy? (for latest) }. Without from, via is a link field on this table. Examples: open repairs on a room = count of jobs where status neq done; a room's rent status = latest status of its rent charges with due lte @today, sortBy due. Screens just read the rollup like any field. A component only writes the record the owner is acting on — never "keep X in sync" code that updates other tables, because edits from tables, imports and the API would bypass it.
- When the setup lists screens that don't meet the app rules yet, fix them whenever you change that screen, and fix all of them when the owner asks to tidy up or bring the app up to standard.
- Connections: Settings › Integrations shows each one (Stripe, email, WhatsApp/SMS, calendar feeds, accounting export, AI apps), whether it works and what uses it. When something you set up needs one that isn't connected (online payment on invoices or deposits needs Stripe; WhatsApp or SMS reminders need the business number), say so in one line and point there: "Connect Stripe so Sarah can pay this invoice online — Settings › Integrations." Owners can see bookings in Google, Apple or Outlook by subscribing to their calendar feed on that page.
- Website: change_setup setSite { enabled, title?, description? (search engines), sections: [{ id: "sec_…", type, title?, … }], contact?: { table, name, email?, phone?, message? } }. Section types: hero { subtitle, image?, cta: book | contact | call }, services and team (live from the booking setup), about { text, image? }, gallery { images }, reviews { quotes: [{ text, name }], link? }, banner { text, tone?: accent | amber | neutral } (a special or notice), hours (opening hours, address, phone), contact { intro? } (the form adds a lead/client record). Images are files the owner uploaded ({ path, name }). Address and phone come from updateBusiness { address, phone }. The site lives at /s/<slug> (Settings › Website, which also makes a first version from the setup). Send the whole site with your change; keep section ids.
- Private fields (alarm codes, lockbox and gate codes, health notes): set sensitive: true on the field. They show as dots until tapped, and query_records hides them from you; get_record with reveal: true only when the task needs that value (e.g. sending a cleaner tomorrow's alarm code).
- Show hierarchy: a record always appears with its parent for context (rooms grouped under or labelled with their building, tenants with their room and building, jobs with room and building). Lists of child records group by parent or show the parent in a column; detail views show the path (Building › Room). When designing tables, link children to their parent (room → building) instead of copying names. Pickers follow the hierarchy by themselves: a record that links to an owner and a pet, where the pet links to its owner, only offers the chosen owner's pets, fills in the owner when a pet is chosen, and every picker has "+ New …" (made with the parent already chosen). Pickers show the parent ("Biscuit · Lisa Moreau"). Override on the link field with narrowBy { field, via } or turn it off with narrowBy: false.
- Compare choice values to option ids (opt_…), never to label text; labels can be renamed.
- Apps are picture driven. Things people look at (cars, rooms, products, nails, haircuts, jobs before/after) get a photo field, and a gallery when there are several: a file field with multiple: true (addField { type: "file", multiple: true }) holds a list of photos and videos. Forms upload them by themselves (put the field in openRecordForm's fields); record pages let owners drop, paste or snap photos straight in. Show them with FileImage: a cover photo on cards and list rows, large in a detail view; Gallery for a gallery field; tap opens full screen (viewFiles), videos play. FileInput is the uploader for custom forms. Other files (agreements, receipts) show as a chip that opens them. Never show a file's name where the owner expects the picture.
- Works on a phone: stack columns below md, tables become cards or scroll horizontally, tap targets at least 40px.

Data that stays true (docs/data-rules.md — learned from real apps that sent rent reminders to people who had moved out). Design the data so it can't drift:
- Store facts, derive summaries. Store what happened or what someone decided (start/end dates, paid on, signed on, cancelled). A status that only says where the dates are (upcoming / active / ending / ended, due / late / paid) gets derive rules on the status field: { rules: [{ when: [{ field, op, value }], option }], otherwise }, first match wins; values may be "@today", "@now", "@today+30d", "@today-7d". It's worked out on every read, can't be set by hand and is never moved by an automation. Put decisions people make (cancelled, on hold) in their own stored field and make them the first rule.
- Values that come from other records (a payment's renter status, a room's open repairs, a lease's latest payment) are rollups — never copied.
- Values worked out from the record's own numbers are formula fields: { type: "formula", expression: "fld_qty * fld_unit_price", format: "money" }. Use + - * / %, ( ), comparisons (give 1/0) and round(x, 2), min, max, abs, floor, ceil, if(cond, a, b), coalesce; empty counts as 0. Formulas may use rollups ("fld_total - fld_paid" for a balance), and statuses may follow formulas (Paid when balance lte 0). Never ask the owner to type a total or a balance. Rollups of money set format: "money".
- One field means one thing at all times: "Rent" is today's rent; a change that starts later is "Next rent" + "Next rent from". A change that needs someone's agreement (an extension, a new price, a signature) is its own record ("pending") until confirmed — the live record changes only then.
- Things that repeat per parent (renewals, move-outs, notices) are child records with a status; only one is open at a time (check for an open one before adding; show and act on the open one).
- Never delete settled history (paid, signed): give it a "void"/"archived" status. Ending something (cancel, move out, end) also closes everything hanging off it in the same change — open follow-ups, pending requests.
- Automation steps (checked when saved; a step with unknown keys or placeholders is refused):
  - {"type": "send_message", "to": "<field: the person, e.g. the client link, or an email/phone field>", "channel": "auto" | "email" | "whatsapp" | "sms" (auto = WhatsApp when connected, else email; sms = a text from the business's number), "message": "text" or "template": "tpl_reminder" | "tpl_rebook" | "tpl_review" | "tpl_thanks" | "tpl_shipped" | …}. The email subject comes from the template or "A message from <business>".
  - Placeholders in message: {{fld_x}} (shown readable: dates and times in the business's time, money, option names, a linked record's name), {{fld_link.fld_y}} (a field of the linked record, e.g. {{fld_service.fld_price}}), and {{name}} (the person’s first name), {{business}} (or {{business_name}}), {{when}} (the record’s date/time), {{booking_link}} (the public booking page), {{document_link}} (the client’s link to this quote or invoice), {{manage_link}} (on a booking: the client’s link to see or cancel it — put it in confirmations), {{review_link}}. A line whose link the business doesn’t have yet is left out.
  - {"type": "notify", "message": "…"} tells the owner; {"type": "wait", "duration": "30m" | "2h" | "1d" | "1w"}; {"type": "update_record", "values": {…}} changes the record itself, or with "via": "<link field>" the linked record (e.g. move a quote's job to Won); {"type": "create_record", "table": "tbl_…", "values": {…}}.
- Online booking: every business with scheduling has a public booking page (/book/<slug>; the link is in the setup and in the owner's menu with Share — link, QR code, website button). Don't build a booking page yourself. In screens, useFreeTimes(service, date, staff?) gives real free times and bookTime(...) books one without double-booking (e.g. a walk-in screen).
- Repeating work and charges (rent, memberships, cleanings every 2 weeks, maintenance visits): change_setup setRecurring { id: "rec_…", label, table (the plan or agreement), amount? (its money field), every: "week" | "2weeks" | "4weeks" | "month" | a choice field (Weekly / Every 2 weeks / Monthly), start (a date, or a date-and-time to keep that time of day: "every 2 weeks on Tuesday at 9" = start on a Tuesday 9:00), end?, when?: [conditions, e.g. signed not_empty, status neq cancelled], charges: { table (visits or charges), via (their link to the plan), amount?, due (their date field) }, copy?: [{ from: plan field, to: visit field }] (client, address, crew, service), leadDays? (3 for charges; 21–35 for visits so the schedule shows them) }. One App creates each record ahead and never twice; a deleted (skipped) visit isn't made again; untouched future visits follow edits to the plan and go when it ends or stops. Don't build this with automations or date maths.
- Working hours (scheduling.hours, and a staff member's "hours" field): {"mon": [["09:00","17:00"]], "tue": [["09:00","12:00"],["13:00","17:00"]], …} in the business's time; a missing day is closed. A staff member with no hours works the business's opening hours. Time off is separate records.
- "eq @today" on a date-and-time field means any time on that local day (also @tomorrow, @yesterday, @this_week, @this_month, @today+7d). On a link that holds several records, filter with "contains" (eq is read as contains).
- Automations that message or charge people state who still qualifies in their conditions (status active, not paid, renter not ended — add a rollup to see the parent's status). One App checks conditions again right before every run and after every wait, so someone who left, cancelled or paid gets nothing. Don't use a condition the automation's own steps would break.
- Time-based behaviour uses date triggers (with an offset like -30d) on the date itself, never "status changed" on a status that follows dates.
- change_setup may answer with fix_these_next: fix those in your next step. The setup summary lists data rules not met yet.

Before you call a screen done, walk through it as the owner would — it must work, not just look right:
- Every add form can be completed: all required fields are in fields (or prefilled in defaults), including file fields.
- Every button does something; every record opens; edit and delete work through openRecordForm.
- Whatever the owner can add (a photo, a document, a date, a status) shows up on the screen afterwards, in a useful form (photos as pictures, statuses as badges, money formatted).
- Empty, loading and long-list states look right; nothing overflows on a phone.
- If the owner asked for something the kit can't do yet, say so plainly instead of building something that only looks like it works.

Recreating an app from screenshots (the owner shows screens of an app they use or made and wants it here):
1. Study every screenshot: the screens, what data they show (lists, records, fields, statuses, amounts, dates), navigation, colours, fonts, spacing.
2. First turn: change_setup with the data model the screens need (tables, fields with the right types and choice options, links) plus setTheme (colours, closest font, radius, menu position matching the app's navigation). Add a few realistic sample records with create_record so screens aren't empty. Then plan_build with one step per screen, each listing the screenshot numbers it reproduces in images.
3. Each following step: build ONE screen as a full-width component on its own page (write_component with newPage, or replaceBlocks on an existing page) that reproduces the screenshot as closely as you can — same structure, hierarchy, density, colours, copy — wired to real data through the kit (useRecords, openRecordForm, records.update…) and following the app rules — even where the screenshot shows an add form inline or on its own screen, use a modal unless the owner says otherwise. Then plan_build marking it done.
${step4}
The kit (@one/kit) and the React subset you can use:
${KIT_DTS}

Server code (write_function):
- For outside services and webhooks: \`export default async function run(ctx: RunContext) { … }\` importing only from "@one/server"; use fetch for HTTP. List every host it calls in hosts.
- API keys: use secret("NAME") as the header value (list_api_keys shows what's saved; ask the owner to add missing ones). Never ask the owner to paste a key into the chat.
- Run it from automations with an action {"type": "run_function", "function": "<id>"}; ctx.record is the record. Webhooks get ctx.request and return { status?, json? | text? }.
- Saving and test runs wait for the owner's confirmation.

The server kit (@one/server):
${SERVER_KIT_DTS}`;
}

export const OWNER_SYSTEM = `${CHAT_INTRO}\n${buildGuide({ renderCheck: true })}`;

/** Compact, id-annotated summary of the setup for the model. */
export function setupSummary(bp: Blueprint, now = new Date(), booking?: { url: string; enabled: boolean } | null): string {
  const lines: string[] = [];
  lines.push(`Business: ${bp.business.name} (${bp.business.type}), timezone ${bp.business.timezone}, today is ${isoDate(localToday(now, bp.business.timezone))}.`);
  lines.push("", "Tables:");
  for (const t of bp.tables) {
    lines.push(`- ${t.id} "${t.label}"${t.primaryField ? ` (title field ${t.primaryField})` : ""}`);
    for (const f of t.fields) {
      let extra = "";
      if (f.type === "status" || f.type === "choice") {
        extra = ` options: ${f.options.map((o) => `${o.id}="${o.label}"`).join(", ")}${f.multiple ? " (multiple)" : ""}`;
        if (f.derive) extra += ` — follows: ${f.derive.rules.map((r) => `${r.option} when ${r.when.map((w) => `${w.field} ${w.op} ${w.value ?? ""}`.trim()).join(" and ")}`).join("; ")}${f.derive.otherwise ? `; else ${f.derive.otherwise}` : ""} (computed, read-only)`;
      }
      if (f.type === "link") extra = ` → ${f.to}${f.multiple ? " (multiple)" : ""}`;
      if (f.type === "money" && f.currency) extra = ` ${f.currency}`;
      if (f.type === "rollup") extra = ` = ${f.agg} of ${f.field} ${f.from ? `from ${f.from} records whose ${f.via} is this record` : `via ${f.via}`}${f.where?.length ? ` where ${f.where.map((w) => `${w.field} ${w.op} ${w.value ?? ""}`.trim()).join(" and ")}` : ""} (computed, read-only)`;
      lines.push(`    ${f.id} "${f.label}" ${f.type}${f.required ? " required" : ""}${extra}`);
    }
  }
  lines.push("", "Pages (menu order):");
  for (const p of menuOrder(bp)) {
    lines.push(`- ${p.id} "${p.label}"${p.hidden ? " (hidden)" : ""}`);
    for (const b of p.layout.blocks) {
      const title = typeof b.options?.title === "string" ? ` "${b.options.title}"` : "";
      const comp = b.type === "custom" ? ` component ${String(b.options?.component)}` : "";
      lines.push(`    ${b.id} ${b.type}${title}${comp}${b.source ? ` from ${b.source.table}` : ""} at x${b.x} y${b.y} w${b.w} h${b.h}`);
    }
    const overrides = Object.keys(p.layoutOverrides ?? {});
    if (overrides.length) lines.push(`    separate layouts: ${overrides.join(", ")}`);
  }
  if (bp.automations.length) {
    lines.push("", "Automations:");
    for (const a of bp.automations) lines.push(`- ${a.id} "${a.label}" ${a.enabled ? "on" : "off"}, trigger ${a.trigger.type}${a.trigger.table ? ` on ${a.trigger.table}` : ""}`);
  }
  if (bp.scheduling) {
    const s = bp.scheduling;
    lines.push("", "Online booking:");
    lines.push(`- Set up: bookings in ${s.bookings.table}, services in ${s.services.table}, staff in ${s.practitioners.table}${s.deposit ? `, deposit ${s.deposit.kind === "percent" ? `${s.deposit.value}%` : s.deposit.value}` : ""}.`);
    lines.push(
      booking
        ? `- Public booking page: ${booking.url} (${booking.enabled ? "taking bookings" : "switched off"}). Give the owner this link to share; they change it under Settings › Booking.`
        : "- The business has a public booking page where clients pick a service, a time and pay any deposit. The owner finds the link, switches it on or off and shares it under Settings › Booking — tell them so after setting bookings up.",
    );
  }
  if (bp.functions?.length) {
    lines.push("", "Server code (read_function for source):");
    for (const f of bp.functions) lines.push(`- ${f.id} "${f.label}" hosts: ${f.hosts.join(", ") || "none"}${f.webhook ? ", webhook" : ""}`);
  }
  if (bp.components?.length) {
    lines.push("", "Custom components (read_component for source):");
    for (const c of bp.components) {
      // Screens built before a rule existed: flagged so they get fixed (when asked, or when touched).
      const { errors, warnings } = checkStandards(c.source, bp);
      const todo = [...errors.map(() => "add/edit form not in a pop-up"), ...warnings.filter((w) => w.includes("belong to")).map((w) => `show ${w.split(" belong to ")[1].split(" (")[0]}`)];
      lines.push(`- ${c.id} "${c.label}"${todo.length ? ` — doesn't meet the app rules yet: ${todo.join("; ")}` : ""}`);
    }
  }
  const checks = checkDataRules(bp);
  if (checks.length) {
    lines.push("", "Data rules not met yet (fix when you touch these, or all when asked to tidy up):");
    for (const c of checks.slice(0, 8)) lines.push(`- ${c}`);
  }
  lines.push("", "The grid has 12 columns; blocks have x, y, w (width in columns) and h (height in rows).");
  return lines.join("\n");
}

export const MAX_IMAGES = 8;
export interface ChatImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
}

/** Validates images from the browser (type, size). */
export function cleanImages(raw: unknown): ChatImage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is ChatImage => !!x && typeof x === "object" && ["image/jpeg", "image/png", "image/webp"].includes((x as ChatImage).mediaType) && typeof (x as ChatImage).data === "string" && /^[A-Za-z0-9+/=]+$/.test((x as ChatImage).data) && (x as ChatImage).data.length < 2_500_000)
    .slice(0, MAX_IMAGES);
}

/** Images are only needed for the turn they were sent in; stored history keeps a note instead. */
export function withoutImages(history: Message[]): Message[] {
  return history.map((m) =>
    m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "image")
      ? { ...m, content: m.content.map((b) => (b.type === "image" ? { type: "text" as const, text: "[The owner attached an image here.]" } : b)) }
      : m,
  );
}

export interface OwnerTurnInput {
  backend: OwnerBackend;
  /** Earlier messages of this owner's conversation (as returned by previous turns). */
  history: Message[];
  message: string;
  /** Page the owner is looking at, so "make this bigger" works. */
  pageId?: string;
  /** Images the owner attached (e.g. a design to match). Base64, already resized by the browser. */
  images?: ChatImage[];
  /** Stop calling the model after this long (ms); defaults to TURN_BUDGET_MS. */
  budgetMs?: number;
  model?: ModelCall;
  /** The business's chosen model id (Settings); the default when unset. */
  modelId?: string | null;
  now?: Date;
  newId?: () => string;
}

export interface OwnerTurnResult {
  /** Full conversation to store for the next turn. */
  history: Message[];
  response: AgentResponse;
  /** Risky actions to store server-side until the owner confirms or cancels. */
  pending: PendingAction[];
  /** Tokens and estimated cost of this turn. */
  usage: TurnUsage;
}

export async function runOwnerTurn(input: OwnerTurnInput): Promise<OwnerTurnResult> {
  const { backend, model = anthropicModel(), now = new Date(), newId = () => crypto.randomUUID() } = input;
  const bp = await backend.blueprint();
  const page = input.pageId ? bp.pages.find((p) => p.id === input.pageId) : undefined;
  const userText = page ? `[The owner is looking at page "${page.label}" (${page.id}).]\n\n${input.message}` : input.message;
  const images = (input.images ?? []).slice(0, MAX_IMAGES);
  const learned = backend.learnings ? await backend.learnings().catch(() => "") : "";
  const newContent: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } })),
    { type: "text" as const, text: userText },
    // The setup lives in the conversation (not the system prompt), so the history stays cacheable.
    { type: "text" as const, text: setupNote(bp, now) },
    // What owners of this kind of business went on to change (approved learnings), when there is any.
    ...(learned ? [{ type: "text" as const, text: learned }] : []),
  ];
  // A turn that stopped right after tool results leaves a user message last; add to it (roles alternate).
  const last = input.history.at(-1);
  const messages: Message[] =
    last?.role === "user"
      ? [...input.history.slice(0, -1), { role: "user", content: [...(typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content), ...newContent] }]
      : [...input.history, { role: "user", content: newContent }];
  let lastSetup = setupNote(bp, now);
  const modelId = resolveAiModel(input.modelId);
  const usage: TurnUsage = { model: modelId, requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
  const startedAt = Date.now();

  const effects: ToolEffects = {};
  const pending: PendingAction[] = [];
  let text = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    if (step > 0 && Date.now() - startedAt > (input.budgetMs ?? TURN_BUDGET_MS)) {
      text = effects.plan ? "Still building — carrying on with the next part." : "That took a while — tell me to continue and I’ll pick up where I left off.";
      break;
    }
    const response = await model({
      model: modelId,
      // Under the SDK's non-streaming limit (~21k); enough for the biggest component (60k chars).
      max_tokens: 21000,
      output_config: { effort: "medium" },
      // Haiku has no server-side refusal fallback.
      ...(modelId.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      system: [{ type: "text", text: OWNER_SYSTEM, cache_control: { type: "ephemeral" } }],
      // Caches the whole conversation so far: each step of a turn re-reads it at a tenth of the price.
      cache_control: { type: "ephemeral" },
      tools: ownerToolDefinitions(),
      messages,
    });
    const u = response.usage;
    if (u) {
      usage.requests++;
      usage.inputTokens += u.input_tokens ?? 0;
      usage.outputTokens += u.output_tokens ?? 0;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    }
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      text = "I can’t help with that one.";
      break;
    }
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "max_tokens" && !text) text = "That got too long — could you ask in smaller steps?";
      break;
    }

    // All results go back in one user message (keeps parallel tool use working).
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) results.push(await runTool(call, backend, effects, pending, newId));
    const setup = setupNote(await backend.blueprint(), now);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    if (setup !== lastSetup) content.push({ type: "text", text: setup });
    lastSetup = setup;
    messages.push({ role: "user", content });
  }

  if (!text) text = pending.length ? "Please confirm below." : "Done.";

  const response: AgentResponse = { text, changed: !!effects.changed };
  if (effects.verify?.length) response.verify = effects.verify;
  if (effects.plan) response.plan = effects.plan;
  if (effects.preview) {
    response.preview = effects.preview;
    response.buttons = [
      { label: "Keep", action: "keep" },
      { label: "Undo", action: "undo" },
    ];
  }
  if (pending.length) {
    response.confirm = { items: pending.flatMap((p) => p.items), actionIds: pending.map((p) => p.id) };
    response.buttons = [
      { label: "Confirm", action: "confirm" },
      { label: "Cancel", action: "cancel" },
    ];
  }
  usage.costUsd = usageCost(usage);
  return { history: messages, response, pending, usage };
}

const setupNote = (bp: Blueprint, now: Date) => `Current setup:\n${setupSummary(bp, now)}`;

async function runTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  backend: OwnerBackend,
  effects: ToolEffects,
  pending: PendingAction[],
  newId: () => string,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: unknown, isError = false): Anthropic.Beta.BetaToolResultBlockParam => {
    let s = typeof content === "string" ? content : JSON.stringify(content);
    if (s.length > MAX_RESULT_CHARS) s = `${s.slice(0, MAX_RESULT_CHARS)}… (truncated; ask for fewer rows)`;
    return { type: "tool_result", tool_use_id: call.id, content: s, ...(isError ? { is_error: true } : {}) };
  };

  const out = await executeOwnerTool(call.name, call.input, backend, effects, newId);
  if (out.kind === "error") return result(out.message, true);
  if (out.kind === "pending") {
    pending.push(out.action);
    if (out.applied !== undefined) return result({ status: "partly_done", done_now: out.applied, waiting_for_owner_confirmation: out.action.items });
    return result({ status: "waiting_for_owner_confirmation", will_do: out.action.items });
  }
  return result(out.value);
}

/**
 * Runs a confirmed PendingAction. Called by app code when the owner presses Confirm, never by
 * the model. Returns effects for the UI and a note to append to the conversation.
 */
export async function runConfirmedAction(backend: OwnerBackend, action: PendingAction): Promise<{ ok: boolean; effects: ToolEffects; note: string; report?: string }> {
  const t = OWNER_TOOLS.find((x) => x.name === action.tool);
  if (!t) throw new Error(`Unknown tool ${action.tool}`);
  const input = t.input.parse(action.input);
  const effects: ToolEffects = {};
  try {
    const result = await t.run(backend, input, effects, { confirmed: true });
    const report = t.report?.(result) ?? undefined;
    return { ok: true, effects, note: `[The owner confirmed and it is done: ${action.items.join("; ")}]${report ? `\n[${report}]` : ""}`, ...(report ? { report } : {}) };
  } catch (e) {
    return { ok: false, effects, note: `[The owner confirmed, but it failed: ${e instanceof Error ? e.message : String(e)}]` };
  }
}
