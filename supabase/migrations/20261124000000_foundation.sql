-- Phase 0 foundation: businesses, memberships, versioned blueprints, change history.
-- Every row carries business_id; RLS enforces isolation by membership (CLAUDE.md rule 7).

create type public.member_role as enum ('owner', 'admin', 'staff');

create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 80),
  type        text not null default 'other',
  timezone    text not null default 'UTC',
  created_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now()
);

create table public.memberships (
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- One row per version; rows are immutable. The latest version is the live blueprint.
create table public.blueprints (
  business_id uuid not null references public.businesses (id) on delete cascade,
  version     int  not null check (version >= 1),
  json        jsonb not null,
  created_by  uuid default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now(),
  primary key (business_id, version),
  check ((json ->> 'version')::int = version)
);

-- Every applied change set, UI or AI, with the inverse needed to undo it.
create table public.blueprint_history (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  from_version  int  not null,
  to_version    int  not null,
  source        text not null check (source in ('ui', 'ai', 'undo', 'system')),
  summary       text,
  change_set    jsonb not null,
  inverse       jsonb not null,
  undoes        uuid references public.blueprint_history (id),
  created_by    uuid default auth.uid() references auth.users (id),
  created_at    timestamptz not null default now(),
  foreign key (business_id, to_version) references public.blueprints (business_id, version)
);
create index blueprint_history_business_idx on public.blueprint_history (business_id, created_at desc);

-- ---------- membership helpers (security definer so policies don't recurse) ----------

create function public.is_member(bid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships m where m.business_id = bid and m.user_id = auth.uid());
$$;

create function public.has_role(bid uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = bid and m.user_id = auth.uid() and m.role = any (roles)
  );
$$;

-- ---------- RLS ----------

alter table public.businesses enable row level security;
alter table public.memberships enable row level security;
alter table public.blueprints enable row level security;
alter table public.blueprint_history enable row level security;

create policy "members read their businesses" on public.businesses
  for select to authenticated using (public.is_member(id));
create policy "owners and admins update their business" on public.businesses
  for update to authenticated
  using (public.has_role(id, '{owner,admin}')) with check (public.has_role(id, '{owner,admin}'));
-- Businesses are created through create_business(); deleted by owners only.
create policy "owners delete their business" on public.businesses
  for delete to authenticated using (public.has_role(id, '{owner}'));

create policy "members see co-members" on public.memberships
  for select to authenticated using (public.is_member(business_id));
create policy "owners manage memberships" on public.memberships
  for all to authenticated
  using (public.has_role(business_id, '{owner}')) with check (public.has_role(business_id, '{owner}'));

create policy "members read blueprints" on public.blueprints
  for select to authenticated using (public.is_member(business_id));
create policy "owners and admins write blueprints" on public.blueprints
  for insert to authenticated with check (public.has_role(business_id, '{owner,admin}'));

create policy "members read history" on public.blueprint_history
  for select to authenticated using (public.is_member(business_id));
create policy "owners and admins write history" on public.blueprint_history
  for insert to authenticated with check (public.has_role(business_id, '{owner,admin}'));

-- No update/delete policies on blueprints or history: they are append-only.

-- ---------- RPCs ----------

-- Creates a business, makes the caller its owner and stores blueprint v1, atomically.
-- The blueprint is validated by the app (zod) before it gets here.
create function public.create_business(p_name text, p_type text, p_timezone text, p_blueprint jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  bid uuid;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if (p_blueprint ->> 'version')::int is distinct from 1 then
    raise exception 'initial blueprint must be version 1' using errcode = '22023';
  end if;

  insert into public.businesses (name, type, timezone, created_by)
    values (p_name, p_type, p_timezone, uid) returning id into bid;
  insert into public.memberships (business_id, user_id, role) values (bid, uid, 'owner');
  insert into public.blueprints (business_id, version, json, created_by) values (bid, 1, p_blueprint, uid);
  insert into public.blueprint_history (business_id, from_version, to_version, source, summary, change_set, inverse, created_by)
    values (bid, 0, 1, 'system', 'Created business', '{}'::jsonb, '{}'::jsonb, uid);
  return bid;
end;
$$;

-- Appends a new blueprint version + history entry. Runs as the caller, so RLS applies.
-- Fails with 40001 if someone else committed first (expected_version is stale).
create function public.commit_blueprint_version(
  p_business_id uuid,
  p_expected_version int,
  p_blueprint jsonb,
  p_source text,
  p_summary text,
  p_change_set jsonb,
  p_inverse jsonb,
  p_undoes uuid default null
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare
  latest int;
  hid uuid;
begin
  -- Serialize commits per business.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  select max(version) into latest from public.blueprints where business_id = p_business_id;
  if latest is null then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  if latest <> p_expected_version then
    raise exception 'blueprint changed: expected version %, latest is %', p_expected_version, latest
      using errcode = '40001';
  end if;

  insert into public.blueprints (business_id, version, json)
    values (p_business_id, latest + 1, p_blueprint);
  insert into public.blueprint_history
    (business_id, from_version, to_version, source, summary, change_set, inverse, undoes)
    values (p_business_id, latest, latest + 1, p_source, p_summary, p_change_set, p_inverse, p_undoes)
    returning id into hid;
  return hid;
end;
$$;

revoke execute on function public.create_business(text, text, text, jsonb) from public, anon;
grant execute on function public.create_business(text, text, text, jsonb) to authenticated;
revoke execute on function public.commit_blueprint_version(uuid, int, jsonb, text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.commit_blueprint_version(uuid, int, jsonb, text, text, jsonb, jsonb, uuid) to authenticated;

-- Convenience view: the live blueprint per business (RLS of blueprints applies).
create view public.current_blueprints with (security_invoker = true) as
  select distinct on (business_id) business_id, version, json, created_at
  from public.blueprints
  order by business_id, version desc;
