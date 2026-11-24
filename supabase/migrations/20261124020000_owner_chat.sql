-- Owner chat: one conversation per owner per business (CLAUDE.md rule 6), plus risky actions
-- the agent proposed that wait for the owner's confirmation. Private to the user who owns them.

create table public.owner_conversations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Full Messages API history (incl. tool calls), replayed to the model each turn.
  history     jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
  -- What the chat panel shows: [{ role, text, response? }]
  transcript  jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  updated_at  timestamptz not null default now(),
  unique (business_id, user_id)
);

create table public.agent_pending_actions (
  id              uuid primary key,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tool            text not null,
  input           jsonb not null,
  items           jsonb not null,
  status          text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'failed')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index agent_pending_actions_user_idx on public.agent_pending_actions (business_id, user_id, status);

alter table public.owner_conversations enable row level security;
alter table public.agent_pending_actions enable row level security;

-- Only owners/admins get an owner agent; each sees only their own conversation and actions.
create policy "own conversation" on public.owner_conversations
  for all to authenticated
  using (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'))
  with check (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'));

create policy "own pending actions" on public.agent_pending_actions
  for all to authenticated
  using (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'))
  with check (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'));
