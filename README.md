# One App

Describe your business, get a working management system: pages, bookings, automations, payments and a
WhatsApp line for your customers — all changeable by clicking or by asking the AI.

- Start here: `CLAUDE.md`
- Specs: `docs/`
- Build order: `docs/roadmap.md`

## Develop

```bash
npm install
cp .env.example .env.local   # optional: uncomment and fill in Supabase / Anthropic keys
npm run dev
```

Open http://localhost:3000. Without Supabase settings every route redirects to `/demo`: a sample salon on in-memory data.

Apply `supabase/migrations/*.sql` to your Supabase project (`supabase db push` or the SQL editor).

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (blueprint schema, change-set engine) |
| `npm run test:db` | RLS tests on a throwaway local Postgres (needs `initdb`, or set `TEST_DATABASE_URL`) |
| `npm run typecheck` / `npm run lint` / `npm run build` | The rest of CI |
| `npm run e2e` | Browser checks of Edit mode and the assistant on `/demo` (needs a running app with `ANTHROPIC_BASE_URL` pointed at `node e2e/fake-anthropic.cjs`) |

### Layout
- `src/schema/` — zod schemas: `blueprint.ts`, `changeSet.ts`
- `src/engine/changeSet.ts` — `previewChangeSet` / `applyChangeSet` / `undoChangeSet` (pure)
- `src/engine/records.ts`, `store.ts`, `blockData.ts` — record validation, typed queries, block data (Supabase or in-memory store)
- `src/components/` — app shell, page grid, blocks
- `src/automations/` — automation engine (matching, due dates, steps, retries) and runner; worker at `/api/cron/automations` (Vercel Cron every 5 min, needs `SUPABASE_SECRET_KEY` + `CRON_SECRET`)
- `src/email/` — email rules (From/Reply-To, templates, recipients, inbound + webhook signatures); Resend wiring in `src/server/email.ts`, webhook at `/api/webhooks/resend`
- `src/agent/` — owner agent: typed tools, tool loop, structured replies
- `src/server/` — Supabase-backed blueprints, records, store (RLS applies)
- `supabase/migrations/` — tables, RLS policies, `create_business` + `commit_blueprint_version` RPCs
