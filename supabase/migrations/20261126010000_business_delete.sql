-- Deleting a business cascades to its records; the record triggers must not then log rows
-- for a business that no longer exists (that made business deletion fail).

create or replace function public.audit_records()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (new.business_id, auth.uid(), public.request_source(), 'record.created', new.table_id, new.id, jsonb_build_object('after', new.data));
  elsif tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('before', old.data -> k, 'after', new.data -> k))
      into changed
      from (select jsonb_object_keys(old.data) as k union select jsonb_object_keys(new.data)) keys
      where (old.data -> k) is distinct from (new.data -> k);
    if changed is null then return new; end if;
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (new.business_id, auth.uid(), public.request_source(), 'record.updated', new.table_id, new.id, jsonb_build_object('changes', changed));
  else
    -- The whole business is being deleted: nothing to log against.
    if not exists (select 1 from public.businesses where id = old.business_id) then return old; end if;
    insert into public.audit_log (business_id, actor_id, source, action, table_id, record_id, details)
      values (old.business_id, auth.uid(), public.request_source(), 'record.deleted', old.table_id, old.id, jsonb_build_object('before', old.data));
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.record_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  src text := public.request_source();
begin
  if src = 'system' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.data = old.data then return new; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses where id = old.business_id) then return old; end if;
  insert into public.record_events (business_id, table_id, record_id, kind, before, after, source)
    values (coalesce(new.business_id, old.business_id), coalesce(new.table_id, old.table_id), coalesce(new.id, old.id),
            case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
            case when tg_op = 'INSERT' then null else old.data end,
            case when tg_op = 'DELETE' then null else new.data end, src);
  return coalesce(new, old);
end;
$$;
