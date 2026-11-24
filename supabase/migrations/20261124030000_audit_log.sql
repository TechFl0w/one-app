-- Audit log: who changed what, from where (UI, API or the assistant). Written only by triggers,
-- so every path is covered; append-only; readable by owners and admins.

create table public.audit_log (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  -- 'ui' (app / API) or 'ai' (owner assistant); set by the app via the x-one-source header.
  source      text not null default 'ui' check (source in ('ui', 'ai', 'undo', 'system')),
  action      text not null,          -- record.created | record.updated | record.deleted | setup.changed | confirmation.confirmed | …
  table_id    text,
  record_id   uuid,
  summary     text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_business_idx on public.audit_log (business_id, created_at desc);

alter table public.audit_log enable row level security;
create policy "owners and admins read the audit log" on public.audit_log
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
-- No insert/update/delete policies: only the triggers below (security definer) write here.
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- Where the current request came from: PostgREST exposes request headers per transaction.
create function public.request_source()
returns text language sql stable set search_path = ''
as $$
  select case coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-one-source', 'ui')
    when 'ai' then 'ai' else 'ui' end;
$$;

create function public.audit_records()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (new.business_id, auth.uid(), public.request_source(), 'record.created', new.table_id, new.id, jsonb_build_object('after', new.data));
  elsif tg_op = 'UPDATE' then
    -- Only the fields that changed, before and after.
    select jsonb_object_agg(k, jsonb_build_object('before', old.data -> k, 'after', new.data -> k))
      into changed
      from (select jsonb_object_keys(old.data) as k union select jsonb_object_keys(new.data)) keys
      where (old.data -> k) is distinct from (new.data -> k);
    if changed is null then return new; end if;
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (new.business_id, auth.uid(), public.request_source(), 'record.updated', new.table_id, new.id, jsonb_build_object('changes', changed));
  else
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (old.business_id, auth.uid(), public.request_source(), 'record.deleted', old.table_id, old.id, jsonb_build_object('before', old.data));
  end if;
  return coalesce(new, old);
end;
$$;
create trigger records_audit after insert or update or delete on public.records
  for each row execute function public.audit_records();

create function public.audit_blueprint()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.audit_log (business_id, actor_id, source, action, summary, details)
    values (new.business_id, new.created_by,
            case when new.source = 'ui' then public.request_source() else new.source end,
            case when new.source = 'undo' then 'setup.undone' else 'setup.changed' end,
            new.summary,
            jsonb_build_object('from_version', new.from_version, 'to_version', new.to_version, 'history_id', new.id));
  return new;
end;
$$;
create trigger blueprint_history_audit after insert on public.blueprint_history
  for each row execute function public.audit_blueprint();

create function public.audit_confirmations()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status and new.status <> 'pending' then
    insert into public.audit_log (business_id, actor_id, source, action, summary, details)
      values (new.business_id, auth.uid(), 'ai', 'confirmation.' || new.status,
              (select string_agg(value, '; ') from jsonb_array_elements_text(new.items)),
              jsonb_build_object('tool', new.tool, 'action_id', new.id));
  end if;
  return new;
end;
$$;
create trigger agent_pending_actions_audit after update on public.agent_pending_actions
  for each row execute function public.audit_confirmations();
