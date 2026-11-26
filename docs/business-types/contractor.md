# Contractors: landscapers, electricians, plumbers, builders

**What they live on:** winning work with quotes, getting paid for it. The van is the office: the
phone is the main screen.

## Day to day
- A lead calls → job (Lead) → site visit (photos, access notes) → **quote with a scope of work** →
  client accepts online → scheduled → in progress (before/after photos) → done → **invoice** → paid.
- Quotes: labour, materials, equipment lines; tax; valid-until; deposit terms. Chasing unanswered
  quotes is where money is lost.
- Invoices: from the accepted quote, part payments (deposit), overdue reminders.

## Template (src/templates/contractor.ts)
- Tables: Clients, Sites (photos, access notes), Crew, Jobs (stage pipeline, crew, photos, quoted /
  accepted / invoiced / owed rollups), Quotes + lines, Invoices + lines, Payments.
- Pages: Today (greeting, starting this week, quotes out, won this month, overdue), Jobs board
  (next-stage buttons), Schedule, Quotes, Invoices, Clients, Sites gallery, Crew; record pages for
  job, quote (live document + lines), invoice (document + payments), client, site.
- Automations: follow up on quotes 3 days after sending, remind clients the day after an invoice is
  due, tell the owner when a quote is accepted (all re-check the status before acting).
- Trade question (landscaping / electrical / plumbing / building) picks the sample work.
- Demos: `/demo?type=contractor` (Greenline Landscaping), `/demo?type=electrician` (Brightwire Electric).

## Next
- Deposits requested on acceptance (Stripe), recurring maintenance visits (lawn care contracts),
  materials price list to pick lines from, crew day sheets, time tracking against jobs.
