-- Hard guarantee against double booking. Bookings stay generic records (so pages, blocks,
-- automations and the assistant see them), and this table mirrors each active booking's time
-- with overlap constraints per practitioner and per resource. A trigger keeps it in sync using
-- the business's scheduling section (which table/fields are bookings, which statuses free time).

create extension if not exists btree_gist with schema extensions;

create table public.booking_slots (
  record_id       uuid primary key references public.records (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  practitioner_id uuid,
  resource_id     uuid,
  during          tstzrange not null,
  constraint booking_slots_practitioner_overlap exclude using gist (business_id with =, practitioner_id with =, during with &&) where (practitioner_id is not null),
  constraint booking_slots_resource_overlap exclude using gist (business_id with =, resource_id with =, during with &&) where (resource_id is not null)
);

alter table public.booking_slots enable row level security;
revoke all on public.booking_slots from anon, authenticated; -- internal only

create function public.sync_booking_slot()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  rec public.records := coalesce(new, old);
  sc jsonb;
  b jsonb;
  status text;
  starts timestamptz;
  ends timestamptz;
  hold_until timestamptz;
  as_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  delete from public.booking_slots where record_id = rec.id;
  if tg_op = 'DELETE' then return old; end if;

  select json -> 'scheduling' into sc from public.blueprints
   where business_id = new.business_id order by version desc limit 1;
  if sc is null or new.table_id is distinct from sc -> 'bookings' ->> 'table' then return new; end if;
  b := sc -> 'bookings';

  status := new.data ->> (b ->> 'status');
  if status is not null and status in (sc -> 'statuses' ->> 'cancelled', sc -> 'statuses' ->> 'no_show') then return new; end if;
  if b ? 'holdUntil' and status = sc -> 'statuses' ->> 'held' then
    hold_until := nullif(new.data ->> (b ->> 'holdUntil'), '')::timestamptz;
    if hold_until is not null and hold_until <= now() then return new; end if;
  end if;

  begin
    starts := (new.data ->> (b ->> 'start'))::timestamptz;
    ends := (new.data ->> (b ->> 'end'))::timestamptz;
  exception when others then
    return new; -- unparsable times: nothing to guard
  end;
  if starts is null or ends is null or ends <= starts then return new; end if;

  insert into public.booking_slots (record_id, business_id, practitioner_id, resource_id, during)
  values (
    new.id, new.business_id,
    case when new.data ->> (b ->> 'practitioner') ~ as_uuid then (new.data ->> (b ->> 'practitioner'))::uuid end,
    case when b ? 'resource' and new.data ->> (b ->> 'resource') ~ as_uuid then (new.data ->> (b ->> 'resource'))::uuid end,
    tstzrange(starts, ends, '[)')
  );
  return new;
exception
  when exclusion_violation then
    raise exception 'That time overlaps another booking' using errcode = '23P01';
end;
$$;

create trigger records_booking_slot after insert or update or delete on public.records
  for each row execute function public.sync_booking_slot();
