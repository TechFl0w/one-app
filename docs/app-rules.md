# App rules

Defaults every screen the assistant builds follows, so a generated app is usable right away.
The owner can ask for something else; the rules are in the owner agent's prompt
(`src/agent/ownerAgent.ts`, "App rules") — keep this file and that section in sync.

- **Add and edit in a modal.** "Add …" opens `openRecordForm({ table, fields, defaults })`; edit
  opens it with `recordId`. No permanent add forms on a page, no separate add pages — even when a
  screenshot being recreated shows one. Inline `RecordForm` only when the design is the form.
- **Sensible forms:** name/title first, required fields early, at most ~8 fields, prefilled from
  context (the client/room/date being viewed).
- **Edit and delete everywhere:** every record shown can be opened, changed and deleted (the
  record pop-up has Delete; amount changes are confirmed by One App). Standard tables too.
- **Rows open details.** Clicking a row or card shows the record. No dead buttons or links.
- **Lists:** search when there can be more than ~10 items, a sensible default sort, a friendly
  empty state with the add button, a spinner while loading.
- **Formatting:** statuses/choices as coloured badges (option colours), money with
  `formatMoney`, dates with `formatDate`, links with `recordLabel` — never raw ids.
- **Real data:** totals and counts from records, never hardcoded; sample data goes in records.
- **Safe changes:** deleting via `records.remove` (One App confirms); feedback via toast; lists
  refresh themselves.
- **One primary action** per screen, top right; destructive actions secondary and red.
- **Phones:** columns stack below `md`, tables become cards or scroll, tap targets ≥ 40px.
- **Business rules in the data:** derived/synced values (a room's status from its tenant, an
  open-maintenance flag, totals) are rollup/formula fields or automations — never block code that
  updates other tables, which tables, imports and the API would bypass.
- **Hierarchy:** records always show their parent for context (rooms with their building, tenants
  with room and building). Lists group by parent or show it in a column; details show the path
  (Building › Room). Children link to their parent rather than copying names.
- **Plain language:** the assistant talks about what the owner will notice, never about code,
  functions, fields or automations; work that waits on a confirmation continues by itself.
- **Ids, not labels:** compare choices to option ids, never label text.
- **Inputs:** only the kit's Select / DateTimeInput (never native, never hand-made popovers).
