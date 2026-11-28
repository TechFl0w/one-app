# Test API (AI testers)

Fresh test businesses on demand, for AI testers running the business scenarios from an empty
account. Turned on by setting `TEST_API_TOKEN` (24+ random characters) in the server's
environment; without it the routes answer 404. Every call sends `Authorization: Bearer <TEST_API_TOKEN>`.

| Call | What it does |
| --- | --- |
| `POST /api/test/businesses` `{ template, name?, timezone?, answers? }` | Makes a test business from a template (`appointments`, `contractor`, `mechanic`, `chair_rental`, `maker_shop`, `blank`) with sample data. Returns `{ businessId, token, mcpUrl, seeded }`: connect to `mcpUrl` with `token` as the bearer — one token per business, so testers never sign each other out. |
| `POST /api/test/businesses/:id/clock` `{ now }` or `{ hours }` | Moves that business's clock: due-date reminders, recurring charges and visits, expired holds and every job due by then run — for that business only. |
| `GET /api/test/businesses/:id/outbox` | The emails and texts it would have sent. Test businesses never send: messages are stored as `captured`. |
| `DELETE /api/test/businesses/:id` | Removes it and everything in it. Real businesses are refused. |

Test businesses belong to one tester account (`TEST_OWNER_EMAIL`, default `ai-tester@one-app.invalid`) and are
marked `businesses.is_test`. Payments use whatever Stripe keys the server has — use test keys on a preview deployment.

A preview deployment only has `TEST_API_TOKEN` if it was built after the variable was added: the
branch address (`one-app-git-<branch>-…`) follows new commits, not redeploys. Behind Vercel
deployment protection, send `x-vercel-protection-bypass: <secret>` too (ai-explore: `VERCEL_BYPASS`).
