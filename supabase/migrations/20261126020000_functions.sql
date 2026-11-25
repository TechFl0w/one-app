-- Generated server functions: their runs (log + one-time token for the kit API) and the business's
-- saved API keys. Keys are written and read only by the server (service role); owners see names.

create table public.function_runs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  function_id  text not null check (function_id ~ '^fn_[a-z0-9_]{1,60}$'),
  trigger      text not null check (trigger in ('automation', 'webhook', 'test')),
  -- Automation step key: a step that already ran successfully isn't run again on retry.
  key          text,
  -- sha256 of the run token the VM firewall adds to its calls to One App; valid while running.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'running' check (status in ('running', 'ok', 'error')),
  output       jsonb,
  error        text,
  logs         jsonb not null default '[]' check (jsonb_typeof(logs) = 'array'),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  expires_at   timestamptz not null
);
create index function_runs_business_idx on public.function_runs (business_id, started_at desc);
create index function_runs_key_idx on public.function_runs (business_id, key) where key is not null;

create table public.business_secrets (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  name         text not null check (name ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  host         text not null check (host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  header       text not null default 'Authorization' check (header ~ '^[A-Za-z0-9-]{1,40}$'),
  prefix       text not null default 'Bearer ' check (length(prefix) <= 20),
  value        text not null check (length(value) between 1 and 4000),
  created_at   timestamptz not null default now(),
  primary key (business_id, name)
);

alter table public.function_runs enable row level security;
alter table public.business_secrets enable row level security;

create policy "owners and admins read function runs" on public.function_runs
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
revoke insert, update, delete on public.function_runs from anon, authenticated;
-- The token hash is never readable through the API (column grants only work without a table grant).
revoke select on public.function_runs from anon, authenticated;
grant select (id, business_id, function_id, trigger, key, status, output, error, logs, started_at, finished_at, expires_at) on public.function_runs to authenticated;

-- No policies on business_secrets: signed-in users can't read or write it at all. Owners list the
-- names through business_secret_names (no values); the server writes with the service role.
revoke all on public.business_secrets from anon, authenticated;

create function public.business_secret_names(bid uuid)
returns table (name text, host text, header text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.name, s.host, s.header, s.created_at from public.business_secrets s
  where s.business_id = bid and public.has_role(bid, '{owner,admin}')
  order by s.name;
$$;
revoke execute on function public.business_secret_names(uuid) from public, anon;
grant execute on function public.business_secret_names(uuid) to authenticated;
