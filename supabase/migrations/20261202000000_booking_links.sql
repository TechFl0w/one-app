-- A client's private link to manage their booking (/book/<slug>/b/<token>): see it, add it to
-- their calendar, cancel it within the business's cancel window. Server only (service role).
create table public.booking_links (
  token       text primary key check (length(token) >= 24),
  business_id uuid not null references public.businesses (id) on delete cascade,
  record_id   uuid not null,
  created_at  timestamptz not null default now(),
  unique (business_id, record_id)
);
alter table public.booking_links enable row level security;
create policy "members read their booking links" on public.booking_links
  for select to authenticated using (public.is_member(business_id));
revoke insert, update, delete on public.booking_links from anon, authenticated;
