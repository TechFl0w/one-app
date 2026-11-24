# Integrations

Goal: most businesses need **zero connections on day one**; others are one click, asked for at the moment
they're needed (inside the "what I'll build" checklist), with visible health status.

## Built in
- **Email — Resend.** Send from a shared subdomain, e.g. `From: "Polished Nail Bar" <bookings@mail.buildingwaves.tech>`.
  `Reply-To` = owner's own address (Gmail fine) or `<slug>@in.buildingwaves.tech` (Resend inbound → webhook →
  app Inbox → forwarded to owner). Inbound webhook carries metadata only; fetch body via the Receiving API.
  Never send *from* the owner's Gmail address. Optional later: custom domain wizard (DNS records).
- **Calendar.** Bookings live in-app; customers get .ics invites.
- **Inbound forwarding address** per business, so owners can forward order/booking emails without granting inbox access.

## One-click
- **Stripe Connect** (embedded components, networked onboarding for existing Stripe users). Deposits, payment
  links, recurring rent/memberships, refunds; platform fee possible. Fallback: "use payment links for now".
- **Google / Outlook calendar sync** for staff busy times (Google calendar scopes: verification, no security assessment).
- **Gmail send-as** (`gmail.send`, sensitive scope, no assessment). Avoid inbox **read** scopes in v1 —
  restricted, require yearly CASA assessment.

## Long tail
Integration service (Nango / Composio / Pipedream Connect) for Etsy, Shopify, QuickBooks, Square, etc.,
plus generic webhook in/out. Every connector is described once (auth, triggers, actions, fields) and used by the
automation builder, the agents and the MCP server alike.

## Competitor imports
Square has a real Bookings API (two-way possible; seller-level writes need a paid Square plan). Vagaro API is
gated (card processing + approval). Fresha has no public API (reporting-only data connector). Strategy: CSV/API
**import + switch-day flow**, optional short run-in sync for Square only.

## WhatsApp
- **Customer line per business** (phase 3): Meta Tech Provider via Twilio. Buy number via API (Twilio handles
  the verification code), owner completes one Embedded Signup popup (pre-filled), then register sender, submit
  starter templates, route to customer agent. Or connect/migrate an existing number (coexistence with the
  WhatsApp Business app supported). Display name approval and template approval take time.
- **Owner line**: not in v1. Owners use in-app chat. If added later: one shared platform number, routed by
  verified phone; note Meta's Jan 2026 rule against AI-as-primary-product on the Business API.
- Test a Canadian Twilio number end to end before committing to them.
