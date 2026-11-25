-- What the assistant costs: one row per chat turn (tokens + estimated USD), so spend is visible.
create table public.ai_usage (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  user_id             uuid not null default auth.uid(),
  model               text not null check (length(model) <= 80),
  requests            int not null default 0 check (requests >= 0),
  input_tokens        bigint not null default 0 check (input_tokens >= 0),
  output_tokens       bigint not null default 0 check (output_tokens >= 0),
  cache_read_tokens   bigint not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens  bigint not null default 0 check (cache_write_tokens >= 0),
  cost_usd            numeric(12, 6) not null default 0 check (cost_usd >= 0),
  created_at          timestamptz not null default now()
);
create index ai_usage_business_idx on public.ai_usage (business_id, created_at desc);

alter table public.ai_usage enable row level security;
create policy "owners and admins read ai usage" on public.ai_usage
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins log their own ai usage" on public.ai_usage
  for insert to authenticated with check (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'));
revoke update, delete on public.ai_usage from anon, authenticated;
