# One App

Describe your business, get a working management system: pages, bookings, automations, payments and a
WhatsApp line for your customers — all changeable by clicking or by asking the AI.

- Start here: `CLAUDE.md`
- Specs: `docs/`
- Build order: `docs/roadmap.md`

## Develop

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL + publishable key
npm run dev
```

Apply `supabase/migrations/*.sql` to your Supabase project (`supabase db push` or the SQL editor).

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (blueprint schema, change-set engine) |
| `npm run test:db` | RLS tests on a throwaway local Postgres (needs `initdb`, or set `TEST_DATABASE_URL`) |
| `npm run typecheck` / `npm run lint` / `npm run build` | The rest of CI |

### Layout
- `src/schema/` — zod schemas: `blueprint.ts`, `changeSet.ts`
- `src/engine/changeSet.ts` — `previewChangeSet` / `applyChangeSet` / `undoChangeSet` (pure)
- `src/server/blueprints.ts` — load / commit / undo against Supabase (RLS applies)
- `supabase/migrations/` — tables, RLS policies, `create_business` + `commit_blueprint_version` RPCs
