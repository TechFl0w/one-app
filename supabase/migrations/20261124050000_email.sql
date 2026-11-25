-- Email (Resend): per-business settings, outbound log (idempotent), inbox for inbound mail.

create table public.business_email (
  business_id     uuid primary key references public.businesses (id) on delete cascade,
  -- Inbound address: <slug>@<inbound domain>. Unique across all businesses.
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  from_name       text not null check (length(from_name) between 1 and 64),
  -- Where customer replies go: the owner's own address, or the app Inbox (inbound address).
  reply_mode      text not null default 'inbound' check (reply_mode in ('owner', 'inbound')),
  owner_email     text check (owner_email is null or owner_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  forward_to_owner boolean not null default true,
  updated_at      timestamptz not null default now()
);

create table public.outbound_messages (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  key         text not null,
  channel     text not null check (channel in ('email', 'whatsapp', 'sms')),
  to_address  text not null,
  subject     text,
  body_text   text not null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (business_id, key)
);

create table public.inbox_messages (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  channel       text not null default 'email',
  provider_id   text not null unique,
  from_address  text not null,
  from_name     text,
  to_addresses  text[] not null default '{}',
  subject       text,
  text_body     text,
  html_body     text,
  received_at   timestamptz not null,
  read_at       timestamptz,
  forwarded_at  timestamptz
);
create index inbox_messages_business_idx on public.inbox_messages (business_id, received_at desc);

alter table public.business_email enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.inbox_messages enable row level security;

create policy "owners and admins manage email settings" on public.business_email
  for all to authenticated
  using (public.has_role(business_id, '{owner,admin}')) with check (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read outbound" on public.outbound_messages
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read inbox" on public.inbox_messages
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins mark inbox read" on public.inbox_messages
  for update to authenticated using (public.has_role(business_id, '{owner,admin}')) with check (public.has_role(business_id, '{owner,admin}'));

-- Outbound and inbox are written by the server (service role) only; owners may only mark read.
revoke insert, update, delete on public.outbound_messages from anon, authenticated;
revoke insert, update, delete on public.inbox_messages from anon, authenticated;
grant update (read_at) on public.inbox_messages to authenticated;
