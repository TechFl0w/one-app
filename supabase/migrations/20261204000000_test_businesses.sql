-- Test businesses for AI testers: made and removed through the test API, their emails and
-- texts are captured (never sent), and their clock can be moved forward on its own.
alter table public.businesses add column is_test boolean not null default false;

alter table public.outbound_messages drop constraint if exists outbound_messages_status_check;
alter table public.outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued', 'sent', 'failed', 'skipped', 'captured'));

-- Claim due jobs of one business only (a test business's moved clock never touches others).
create function public.claim_automation_jobs_for(p_business_id uuid, p_now timestamptz, p_limit int)
returns setof public.automation_jobs language sql volatile set search_path = ''
as $$
  update public.automation_jobs j
     set status = 'running', locked_at = p_now, updated_at = p_now
   where j.id in (
     select id from public.automation_jobs
      where business_id = p_business_id
        and run_at <= p_now
        and (status = 'queued' or (status = 'running' and locked_at < p_now - interval '10 minutes'))
      order by run_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;
revoke execute on function public.claim_automation_jobs_for(uuid, timestamptz, int) from public, anon, authenticated;
