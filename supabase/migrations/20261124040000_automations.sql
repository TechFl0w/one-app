-- Automations: an outbox of record events (written by trigger, so every write path counts),
-- a job queue with idempotency keys, a run log, and owner notifications.
-- The worker (cron route) uses the service role; owners/admins can read runs and notifications.

create table public.record_events (
  id           bigint generated always as identity primary key,
  business_id  uuid not null references public.businesses (id) on delete cascade,
  table_id     text not null,
  record_id    uuid not null,
  kind         text not null check (kind in ('created', 'updated', 'deleted')),
  before       jsonb,
  after        jsonb,
  source       text not null,
  at           timestamptz not null default now(),
  processed_at timestamptz
);
create index record_events_unprocessed_idx on public.record_events (id) where processed_at is null;

-- Changes made by automations (source 'system') don't trigger more automations: no loops.
create function public.record_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  src text := public.request_source();
begin
  if src = 'system' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.data = old.data then return new; end if;
  insert into public.record_events (business_id, table_id, record_id, kind, before, after, source)
    values (coalesce(new.business_id, old.business_id), coalesce(new.table_id, old.table_id), coalesce(new.id, old.id),
            case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
            case when tg_op = 'INSERT' then null else old.data end,
            case when tg_op = 'DELETE' then null else new.data end, src);
  return coalesce(new, old);
end;
$$;
create trigger records_event after insert or update or delete on public.records
  for each row execute function public.record_event();

create table public.automation_jobs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  automation_id text not null,
  table_id      text not null,
  record_id     uuid not null,
  key           text not null,
  run_at        timestamptz not null,
  step          int not null default 0,
  attempts      int not null default 0,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'skipped')),
  last_error    text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, key)
);
create index automation_jobs_due_idx on public.automation_jobs (run_at) where status in ('queued', 'running');

create table public.automation_runs (
  id            bigint generated always as identity primary key,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  automation_id text not null,
  job_id        uuid references public.automation_jobs (id) on delete set null,
  record_id     uuid,
  status        text not null check (status in ('done', 'waiting', 'retrying', 'failed', 'skipped')),
  test          boolean not null default false,
  steps         jsonb not null default '[]',
  error         text,
  at            timestamptz not null default now()
);
create index automation_runs_business_idx on public.automation_runs (business_id, automation_id, at desc);

create table public.notifications (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  key         text not null,
  message     text not null,
  link        jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (business_id, key)
);

alter table public.record_events enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.automation_runs enable row level security;
alter table public.notifications enable row level security;
-- record_events / automation_jobs: service role only (no policies).
create policy "owners and admins read runs" on public.automation_runs
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read notifications" on public.notifications
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins mark notifications read" on public.notifications
  for update to authenticated using (public.has_role(business_id, '{owner,admin}')) with check (public.has_role(business_id, '{owner,admin}'));
-- Owners may only mark notifications read: table-level UPDATE would let them rewrite messages.
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke all on public.record_events, public.automation_jobs from anon, authenticated;
revoke insert, update, delete on public.automation_runs from anon, authenticated;

-- Claims due jobs for one worker; concurrent workers skip each other's rows. Jobs stuck in
-- 'running' for 10 minutes (crashed worker) are claimed again.
create function public.claim_automation_jobs(p_now timestamptz, p_limit int)
returns setof public.automation_jobs language sql volatile set search_path = ''
as $$
  update public.automation_jobs j
     set status = 'running', locked_at = p_now, updated_at = p_now
   where j.id in (
     select id from public.automation_jobs
      where run_at <= p_now
        and (status = 'queued' or (status = 'running' and locked_at < p_now - interval '10 minutes'))
      order by run_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;
revoke execute on function public.claim_automation_jobs(timestamptz, int) from public, anon, authenticated;
