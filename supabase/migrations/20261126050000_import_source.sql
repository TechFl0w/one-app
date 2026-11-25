-- Spreadsheet imports: audited as 'import' and they don't trigger automations (no 2,000 welcome
-- messages after importing a client list).

alter table public.audit_log drop constraint audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check check (source in ('ui', 'ai', 'undo', 'system', 'mcp', 'function', 'import'));

create or replace function public.request_source()
returns text language sql stable set search_path = ''
as $$
  select case coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-one-source', 'ui')
    when 'ai' then 'ai' when 'automation' then 'system' when 'mcp' then 'mcp' when 'function' then 'function'
    when 'import' then 'import' else 'ui' end;
$$;

create or replace function public.record_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  src text := public.request_source();
begin
  if src in ('system', 'import') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.data = old.data then return new; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.businesses where id = old.business_id) then return old; end if;
  insert into public.record_events (business_id, table_id, record_id, kind, before, after, source, depth)
    values (coalesce(new.business_id, old.business_id), coalesce(new.table_id, old.table_id), coalesce(new.id, old.id),
            case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
            case when tg_op = 'INSERT' then null else old.data end,
            case when tg_op = 'DELETE' then null else new.data end, src,
            case when src = 'function' then public.request_depth() else 0 end);
  return coalesce(new, old);
end;
$$;
