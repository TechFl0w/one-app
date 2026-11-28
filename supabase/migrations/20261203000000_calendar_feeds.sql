-- Private calendar feeds (/api/cal/<token>.ics): the owner subscribes from Google, Apple or
-- Outlook and sees the business's bookings (or one person's). Read by the server only.
create table public.calendar_feeds (
  token        text primary key check (length(token) >= 24),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  -- One person's bookings (a practitioner record id), or everyone's when null.
  person_id    uuid,
  created_at   timestamptz not null default now(),
  last_read_at timestamptz
);
create unique index calendar_feeds_one_per_person on public.calendar_feeds (business_id, coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.calendar_feeds enable row level security;
create policy "members read their calendar feeds" on public.calendar_feeds
  for select to authenticated using (public.is_member(business_id));
revoke insert, update, delete on public.calendar_feeds from anon, authenticated;
