# Roadmap

Work top to bottom. Each task should end with tests passing and a short PR.

## Phase 0 — Foundation
1. Next.js + TypeScript + Supabase project, auth, `businesses` + `memberships`, RLS policies.
2. zod schemas for the blueprint (`src/schema/`) + `blueprints` / `blueprint_history` tables.
3. `previewChangeSet` / `applyChangeSet` / undo, with unit tests.

## Phase 1 — Configurable app shell
4. Generic records store + CRUD API respecting the blueprint.
5. App shell: sidebar from blueprint (labels, order, hidden), page renderer for a 12-col block grid.
6. Blocks v1: table, board, calendar, form, number, list.
7. Edit mode: rename/reorder/hide menu items, rename/add/remove fields, drag/resize blocks, add page (blank / layout).
8. Layout overrides per device and per user.

## Phase 2 — AI builder & owner chat (in-app)
9. Owner agent with typed tools over blueprint + records; structured responses (text/preview/buttons/confirm).
10. Chat panel on every page, page-aware; preview → Keep/Undo.
11. Onboarding interview + 3 templates: nail salon (bookings), chair rental, maker shop (orders).
12. Risky-action confirmations + audit log.

## Phase 3 — Automations
13. Trigger/condition/action engine, job queue, retries, idempotency, run log, test mode.
14. Resend email (shared subdomain, Reply-To, inbound address → Inbox).

## Phase 4 — Bookings
15. Resources, practitioners, services, slot finder (tested), bookings lifecycle, public booking page.
16. Stripe Connect (embedded onboarding), deposits, payment links, recurring charges.
17. Reminders, rebooking nudges, review requests.

## Phase 5 — Customer WhatsApp
18. Twilio Tech Provider flow: buy number / connect existing, Embedded Signup, templates.
19. Customer agent with limited toolset; escalation to owner.

## Phase 6 — Reach
20. MCP server per business. 21. Import tool (CSV + Square API). 22. Calendar sync. 23. Integration service for long tail.
24. Mechanic template (capacity mode, quotes, vehicles).
