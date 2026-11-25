-- Public booking page per business: /book/<slug>.
create table public.booking_pages (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  enabled     boolean not null default true,
  intro       text check (intro is null or length(intro) <= 500),
  updated_at  timestamptz not null default now()
);
alter table public.booking_pages enable row level security;
create policy "owners and admins manage booking page" on public.booking_pages
  for all to authenticated
  using (public.has_role(business_id, '{owner,admin}')) with check (public.has_role(business_id, '{owner,admin}'));
-- Public visitors never query this table directly; the server looks slugs up with the service role.
