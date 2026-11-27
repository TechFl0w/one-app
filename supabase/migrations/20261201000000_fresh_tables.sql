-- A table added to the setup starts empty. Removing a table only takes it out of the setup (so it
-- can be undone) and its records stay; adding a table with the same id again used to bring those
-- old records back (a previous business's clients after "starting over"). Now, adding a table —
-- except by undoing its removal — clears any leftover records with that id first.
create or replace function public.commit_blueprint_version(
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

  if p_source <> 'undo' then
    delete from public.records r
      where r.business_id = p_business_id
        and r.table_id in (
          select op -> 'table' ->> 'id'
            from jsonb_array_elements(coalesce(p_change_set -> 'ops', '[]'::jsonb)) op
            where op ->> 'op' = 'addTable'
        );
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
