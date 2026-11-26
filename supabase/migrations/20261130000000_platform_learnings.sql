-- What One App learned from its users: patterns in owners' changes that a platform admin approved
-- (advice for the builder, fields new businesses of that type start with) or dismissed.
-- Platform-wide, not per business: written and read by the server only (service role).
create table public.platform_learnings (
  id            uuid primary key default gen_random_uuid(),
  business_type text not null,
  pattern       text not null,
  kind          text not null,
  text          text not null check (length(text) between 1 and 500),
  payload       jsonb,
  status        text not null check (status in ('advice', 'template', 'dismissed')),
  businesses    integer not null default 0,
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz not null default now(),
  unique (business_type, pattern)
);
alter table public.platform_learnings enable row level security;
revoke all on public.platform_learnings from anon, authenticated;

-- Records per business, for the control center (counts only; server only).
create function public.platform_record_counts()
returns table (business_id uuid, n bigint) language sql stable security definer set search_path = ''
as $$ select r.business_id, count(*) from public.records r group by r.business_id $$;
revoke all on function public.platform_record_counts() from public, anon, authenticated;
grant execute on function public.platform_record_counts() to service_role;
