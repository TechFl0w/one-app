# One App — CLAUDE.md

A configurable business-management platform for small businesses (salons, mechanics, makers, rentals…).
The owner describes their business; an AI assembles a working system (pages, fields, views, automations,
connections) from **prebuilt building blocks**. Think "supercharged Monday.com / Airtable" that sets itself up.

Read `docs/` before building a feature. Build order: `docs/roadmap.md`.

## Non-negotiable architecture rules

1. **Configuration is data; generated code is sandboxed data too.** A business's setup is a *blueprint*
   (JSON, versioned): tables, fields, pages, layouts, automations, connections — and code the AI wrote
   for that business (custom components/pages, websites, server functions). Generated code is stored in
   the blueprint (source + server-compiled output), goes through change sets, and only ever runs in a
   sandbox: browser code in an opaque-origin iframe talking to us via postMessage, server code in an
   isolated VM with a business-scoped token. It never gets platform secrets or direct DB access.
   See `docs/architecture.md` and `docs/generated-code.md`.
2. **Labels are separate from identities.** Every table/field/page/menu item has a stable `id` and an
   editable `label`. Automations, reports and the AI reference ids, so renaming never breaks anything.
3. **Layouts are blocks on a 12-column grid.** Each page = list of blocks `{type, dataSource, position, size, options}`;
   a `custom` block shows a generated component.
   Drag-and-drop and AI edits change the same config. Layouts can be per user and per device.
4. **Two edit paths, one history.** UI edits (Edit mode) and AI edits both produce a blueprint *change set*
   → preview → apply. Every change is logged and undoable.
5. **Agents are separated by code, not prompts.**
   - Owner agent: full tools for the business (same tool surface as the business's MCP server).
   - Customer agent: limited tools (answer, book, take orders). It cannot call admin tools at all.
   - Who is talking is decided before the model sees the message (authenticated user / sender number).
   - Risky actions (delete data, refunds, price changes, bulk messages, automation changes) need explicit confirmation.
6. **Channel-agnostic chat.** One owner agent, one conversation history per owner. Responses are structured
   (text, preview, buttons, confirmation) so the in-app chat renders them as UI and WhatsApp/Telegram can later
   render them as image + buttons. Start with **in-app chat only**.
7. **Multi-tenant from day one.** Every row carries `business_id`; Supabase row-level security enforces isolation.

## Stack
- Next.js (App Router, TypeScript, server actions) on Vercel
- Supabase: Postgres, Auth, RLS, Storage, Edge Functions / cron for automation jobs
- Anthropic API (Claude) for the builder/owner agent, using tool calls against our own typed tools
- Later: Stripe Connect (payments), Resend (email), Twilio WhatsApp (customer lines), MCP server per business

## Conventions
- TypeScript strict. Validate all blueprint/config JSON with zod schemas in `src/schema/`.
- Blueprint changes go through one function (`applyChangeSet`) — never mutate config ad hoc.
- Tests for the blueprint engine, slot finder and permission checks are required.
- UI: light, warm look. Off-white `#F7F5F0` ground, white cards, accent forest green `#17694F`,
  font Plus Jakarta Sans, pill buttons. No purple, no dark sidebar. See `docs/design.md`.
- Keep replies and PR descriptions short.
