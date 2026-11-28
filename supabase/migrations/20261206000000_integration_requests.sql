-- Owners asking for an integration that isn't built yet (QuickBooks, Google Calendar sync…):
-- one row per business and integration, so the control center can rank what to build next.
create table public.integration_requests (
  business_id uuid not null references public.businesses (id) on delete cascade,
  integration text not null check (integration ~ '^[a-z0-9_]{2,40}$'),
  requested_by uuid,
  created_at timestamptz not null default now(),
  primary key (business_id, integration)
);
alter table public.integration_requests enable row level security;
create policy "members read their integration requests" on public.integration_requests
  for select to authenticated using (public.is_member(business_id));
create policy "members ask for integrations" on public.integration_requests
  for insert to authenticated with check (public.is_member(business_id));
