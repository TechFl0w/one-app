# Data rules

One App builds systems for other businesses, so the platform has to make the right design the
default. These rules come from a real rental app (HomeBase) where almost every serious bug had
the same cause: **a fact was stored in one place, and other code acted on a copy, a snapshot or a
status that was supposed to mirror it.** Rent was charged to tenants who had left, renewal offers
went to people whose end date was already agreed, and rooms with tenants in them showed as vacant.

Each rule below is either **enforced by the platform** (generated apps get it for free) or a
**build rule** the assistant follows. Build rules are in the build guide (`buildGuide` in
`src/agent/ownerAgent.ts`, "Data that stays true"); keep that section and this file in sync.

## Enforced by the platform

| Lesson | What One App does | Where |
|---|---|---|
| A status is a cache of dates and drifts | **Status fields can follow rules** (`derive`): the first rule whose conditions hold picks the option. Worked out on every read, never stored, can't be set by hand. Dates may use `@today`, `@now`, `@today+30d`, `@today-7d`. | `DeriveRules` in `src/schema/blueprint.ts`, `addComputed` in `src/engine/computed.ts` |
| Copies of other records' values go stale | **Rollups** are computed on every read (and see linked records' derived statuses). | `src/engine/computed.ts` |
| Filters on derived values silently miss | Lists, blocks, number tiles, the assistant and the MCP server **filter and sort on computed fields**: the stored part runs in the database, the rest after computing (up to 5,000 rows). | `queryWithComputed` |
| Automations decided on yesterday's status | Automations read the **live record with computed values**. Conditions accept `@today` and `@today+30d`. | `supabaseAutomationIO.getRecord`, `conditionsHold` |
| Messages to people who had already left | Conditions are **checked again each time a job runs**, at the start **and after every wait**. If the date moved, a new run is scheduled and the old one is skipped. | `runJob` in `src/automations/runner.ts` |
| Idempotency keys that were fixed forever | Date jobs are keyed on automation + record + **the date value**; every step's effect is keyed on job + step; the database's unique index is the claim. | `dateJobKey`, `automation_jobs` / `notifications` unique keys |
| Overlapping runs sent twice | Jobs are claimed atomically; effects are upserts on their key. | `claim_automation_jobs` |
| Setups that invite these bugs | **Data-rule checks** run after every setup change and are sent back to the assistant (`fix_these_next`). They also appear in the setup summary. The checks: statuses whose options just describe dates; date automations that move a status; message automations that don't re-check who they're for; triggers on derived statuses. Every built-in template must pass them (test). | `checkDataRules` in `src/engine/dataRules.ts` |
| Pages showing old data after navigating | Dynamic pages aren't kept in the browser's router cache (`staleTimes.dynamic = 0`, the Next default, set explicitly). | `next.config.ts` |

## Build rules (the assistant follows them)

- **Store facts, derive summaries.** Store what happened or what someone decided: dates, amounts,
  "paid on", "signed on", "cancelled". A status that only says where the dates are is a derived
  status. Decisions (cancelled, on hold) are their own stored field and come first in the rules.
- **Never copy values from other records.** Use rollups.
- **One field, one meaning.** Use "current" and "upcoming" as two fields ("Rent", "Next rent" +
  "Next rent from"). A change that needs agreement (an extension, a new price, a signature) is a
  pending record until it's confirmed, and the live record changes only then.
- **One open child per parent.** Renewals, move-outs and notices are child records with a status.
  Only one is open at a time. Check before adding one, and show and act on the open one.
- **Soft delete settled history.** Paid or signed records get a void or archived status instead of
  being deleted.
- **Ending something cleans up after it.** A cancel, move-out or end closes everything that hangs
  off the record in the same change.
- **Automations say who still qualifies.** Conditions cover status, not paid, parent not ended
  (via a rollup). The platform re-checks them before every run and after every wait.
- **Time-based behaviour uses date triggers** on the date itself, with an offset, never "status
  changed" on a derived status.

## Not covered yet (next steps)

- **Delivery-driven follow-ups.** "Sent" isn't "delivered". Follow-ups and email fallback should
  be driven by the provider's delivery status.
- **Worker heartbeat.** Each automation tick should write a run row, and a tick that hasn't run
  recently should be reported ("didn't run" counts as a failure).
- **Unique open child enforced by the database.** This could be a table option such as
  `uniqueOpen: { per: fld_parent, where: … }`, checked on write.
- **Pending changes as a building block.** For example, an "apply on confirm" action for
  extensions and price changes.
