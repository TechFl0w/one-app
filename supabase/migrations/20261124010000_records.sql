-- Generic records store: tables are blueprint config, not migrations (docs/architecture.md §3).
-- data is keyed by field id; the app validates it against the blueprint before writing.

create table public.records (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  table_id    text not null check (table_id ~ '^tbl_[a-z0-9_]{1,60}$'),
  data        jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index records_table_idx on public.records (business_id, table_id, created_at desc);
create index records_data_idx on public.records using gin (data jsonb_path_ops);

create function public.touch_record()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.business_id := old.business_id; -- records never move between businesses
  new.created_at := old.created_at;
  new.created_by := old.created_by;
  return new;
end;
$$;
create trigger records_touch before update on public.records
  for each row execute function public.touch_record();

alter table public.records enable row level security;

create policy "members read records" on public.records
  for select to authenticated using (public.is_member(business_id));
create policy "members create records" on public.records
  for insert to authenticated with check (public.is_member(business_id));
create policy "members update records" on public.records
  for update to authenticated using (public.is_member(business_id)) with check (public.is_member(business_id));
create policy "owners and admins delete records" on public.records
  for delete to authenticated using (public.has_role(business_id, '{owner,admin}'));

-- Builds the WHERE fragment (" and ...") for record filters. Pure string building; every value
-- goes through format(%L) and field ids are checked against a strict pattern.
-- p_filters: [{ field, op, value?, kind }]   kind: text | number | bool | date | datetime | array
-- The app builds these from the blueprint (src/engine/records.ts).
create function public.records_where(p_filters jsonb)
returns text language plpgsql immutable set search_path = ''
as $$
declare
  f jsonb;
  fld text;
  kind text;
  op text;
  pg_type text;
  expr text;
  is_empty text;
  w text := '';
begin
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]')) loop
    fld := f ->> 'field';
    kind := f ->> 'kind';
    op := f ->> 'op';
    if fld is null or fld !~ '^fld_[a-z0-9_]{1,60}$' then
      raise exception 'invalid filter field %', fld using errcode = '22023';
    end if;
    pg_type := case kind
      when 'text' then 'text' when 'number' then 'numeric' when 'bool' then 'boolean'
      when 'date' then 'date' when 'datetime' then 'timestamptz' when 'array' then 'array' end;
    if pg_type is null then
      raise exception 'invalid filter kind %', kind using errcode = '22023';
    end if;

    expr := format('(r.data ->> %L)::%s', fld, pg_type);
    is_empty := format(
      '(r.data -> %1$L is null or r.data -> %1$L = ''null''::jsonb or r.data -> %1$L = ''""''::jsonb or r.data -> %1$L = ''[]''::jsonb)',
      fld);

    w := w || ' and ' || case
      when op = 'empty' then is_empty
      when op = 'not_empty' then format('not %s', is_empty)
      when kind = 'array' and op = 'contains' then format('coalesce(r.data -> %L ? %L, false)', fld, f ->> 'value')
      when kind = 'text' and op = 'contains' then
        format('%s ilike %L', expr, '%' || replace(replace(replace(f ->> 'value', '\', '\\'), '%', '\%'), '_', '\_') || '%')
      when kind <> 'array' and op in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte') then
        format('%s %s (%L)::%s', expr,
          case op when 'eq' then '=' when 'neq' then 'is distinct from' when 'gt' then '>'
                  when 'gte' then '>=' when 'lt' then '<' else '<=' end,
          f ->> 'value', pg_type)
      else null end;
    if w is null then
      raise exception 'operator % not allowed for % fields', op, kind using errcode = '22023';
    end if;
  end loop;
  return w;
end;
$$;

-- Filtered, sorted, paginated read over one table. Runs as the caller, so RLS applies.
-- p_sort: [{ field, dir, kind }]  field may also be _created_at / _updated_at
create function public.query_records(
  p_business_id uuid,
  p_table_id text,
  p_filters jsonb default '[]',
  p_sort jsonb default '[]',
  p_limit int default 50,
  p_offset int default 0
)
returns table (id uuid, data jsonb, created_at timestamptz, updated_at timestamptz, total bigint)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  f jsonb;
  fld text;
  expr text;
  o text := '';
begin
  for f in select * from jsonb_array_elements(coalesce(p_sort, '[]')) loop
    fld := f ->> 'field';
    expr := case
      when fld = '_created_at' then 'r.created_at'
      when fld = '_updated_at' then 'r.updated_at'
      when fld ~ '^fld_[a-z0-9_]{1,60}$' then
        format('(r.data ->> %L)::%s', fld, case f ->> 'kind'
          when 'number' then 'numeric' when 'bool' then 'boolean' when 'date' then 'date'
          when 'datetime' then 'timestamptz' else 'text' end)
      end;
    if expr is null then
      raise exception 'invalid sort field %', fld using errcode = '22023';
    end if;
    o := o || expr || case when f ->> 'dir' = 'desc' then ' desc nulls last, ' else ' asc nulls last, ' end;
  end loop;

  return query execute format(
    'select r.id, r.data, r.created_at, r.updated_at, count(*) over () as total
       from public.records r
      where r.business_id = $1 and r.table_id = $2 %s
      order by %s r.created_at desc, r.id
      limit $3 offset $4', public.records_where(p_filters), o)
    using p_business_id, p_table_id, least(greatest(coalesce(p_limit, 50), 1), 500), greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- count / sum / avg / min / max over filtered records (number blocks). count ignores p_field.
create function public.aggregate_records(
  p_business_id uuid,
  p_table_id text,
  p_filters jsonb,
  p_agg text,
  p_field text default null
)
returns numeric
language plpgsql stable security invoker set search_path = ''
as $$
declare
  result numeric;
  expr text;
begin
  if p_agg = 'count' then
    expr := 'count(*)';
  elsif p_agg in ('sum', 'avg', 'min', 'max') and p_field ~ '^fld_[a-z0-9_]{1,60}$' then
    expr := format('%s((r.data ->> %L)::numeric)', p_agg, p_field);
  else
    raise exception 'invalid aggregate % on %', p_agg, p_field using errcode = '22023';
  end if;
  execute format(
    'select %s from public.records r where r.business_id = $1 and r.table_id = $2 %s',
    expr, public.records_where(p_filters))
    into result using p_business_id, p_table_id;
  return result;
end;
$$;

revoke execute on function public.aggregate_records(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.aggregate_records(uuid, text, jsonb, text, text) to authenticated;
revoke execute on function public.query_records(uuid, text, jsonb, jsonb, int, int) from public, anon;
grant execute on function public.query_records(uuid, text, jsonb, jsonb, int, int) to authenticated;

-- Atomic partial update: merges p_set into data and removes p_unset keys. Runs as the caller (RLS).
create function public.patch_record(p_business_id uuid, p_table_id text, p_record_id uuid, p_set jsonb, p_unset text[])
returns table (id uuid, data jsonb, created_at timestamptz, updated_at timestamptz)
language sql volatile security invoker set search_path = ''
as $$
  update public.records r
     set data = (r.data || coalesce(p_set, '{}'::jsonb)) - coalesce(p_unset, '{}'::text[])
   where r.business_id = p_business_id and r.table_id = p_table_id and r.id = p_record_id
  returning r.id, r.data, r.created_at, r.updated_at;
$$;

revoke execute on function public.patch_record(uuid, text, uuid, jsonb, text[]) from public, anon;
grant execute on function public.patch_record(uuid, text, uuid, jsonb, text[]) to authenticated;
