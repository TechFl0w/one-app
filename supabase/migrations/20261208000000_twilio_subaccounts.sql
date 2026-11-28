-- Each business gets its own Twilio sub-account (under the platform's account): its number,
-- WhatsApp sender, templates and usage are kept apart. Read by the server only (the token is a key).
create table public.twilio_subaccounts (
  business_id  uuid primary key references public.businesses (id) on delete cascade,
  account_sid  text not null unique check (account_sid ~ '^AC[0-9a-f]{32}$'),
  auth_token   text not null,
  created_at   timestamptz not null default now()
);
alter table public.twilio_subaccounts enable row level security;
revoke all on public.twilio_subaccounts from anon, authenticated;
