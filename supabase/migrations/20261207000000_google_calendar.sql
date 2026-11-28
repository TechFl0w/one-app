-- Google Calendar connections: the business's calendar (person_id null) or one staff member's.
-- Tokens are read by the server only (service role); members see status through the app.
create table public.calendar_connections (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  person_id     uuid,
  provider      text not null default 'google' check (provider in ('google')),
  account_email text,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  calendar_id   text not null default 'primary',
  status        text not null default 'ok' check (status in ('ok', 'error')),
  last_error    text,
  connected_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index calendar_connections_one_per_person on public.calendar_connections (business_id, provider, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.calendar_connections enable row level security;
revoke all on public.calendar_connections from anon, authenticated;

-- When each connection last wrote to Google, and the last error (shown in Settings › Integrations).
alter table public.calendar_connections add column last_synced_at timestamptz, add column last_sync_error text;
