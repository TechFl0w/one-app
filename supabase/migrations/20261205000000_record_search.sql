-- Search: { kind: "search", value: "lisa", links?: ["<id>", …] } matches a record when any of its
-- values contains the words (case-insensitive) or it links to one of the given records (found by
-- name in the app, so "Lisa" also finds Lisa's jobs and invoices).
create or replace function public.records_where(p_filters jsonb)
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
  term text;
  link_ids text[];
begin
  for f in select * from jsonb_array_elements(coalesce(p_filters, '[]')) loop
    kind := f ->> 'kind';
    if kind = 'search' then
      term := left(coalesce(f ->> 'value', ''), 100);
      link_ids := array(select jsonb_array_elements_text(coalesce(f -> 'links', '[]')) limit 200);
      w := w || ' and (' || format('r.data::text ilike %L', '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%')
        || case when cardinality(link_ids) > 0 then format(' or exists (select 1 from jsonb_each(r.data) e where e.value ?| %L::text[] or (jsonb_typeof(e.value) = ''string'' and e.value #>> ''{}'' = any(%L::text[])))', link_ids, link_ids) else '' end
        || ')';
      continue;
    end if;
    fld := f ->> 'field';
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
