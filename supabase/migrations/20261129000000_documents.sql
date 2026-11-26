-- Quotes and invoices (blueprint.documents): numbers that never repeat, and the private links
-- customers open to read, accept or pay them (no account needed; the token is the key).

create table public.document_counters (
  business_id uuid not null references public.businesses (id) on delete cascade,
  document_id text not null,
  last        integer not null default 0,
  primary key (business_id, document_id)
);
alter table public.document_counters enable row level security;
revoke all on public.document_counters from anon, authenticated;

-- Next number for a document ("Q-0007"): members of the business only (or the server).
create function public.next_document_number(p_business_id uuid, p_document_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_member(p_business_id) then
    raise exception 'not a member of this business' using errcode = '42501';
  end if;
  if p_document_id !~ '^doc_[a-z0-9_]{1,60}$' then
    raise exception 'bad document id' using errcode = '22023';
  end if;
  insert into public.document_counters as c (business_id, document_id, last)
    values (p_business_id, p_document_id, 1)
    on conflict (business_id, document_id) do update set last = c.last + 1
    returning last into n;
  return n;
end;
$$;
revoke all on function public.next_document_number(uuid, text) from public, anon;
grant execute on function public.next_document_number(uuid, text) to authenticated, service_role;

create table public.document_links (
  token          text primary key check (length(token) >= 24),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  document_id    text not null,
  record_id      uuid not null,
  created_at     timestamptz not null default now(),
  last_viewed_at timestamptz,
  unique (business_id, document_id, record_id)
);
alter table public.document_links enable row level security;
create policy "members read their document links" on public.document_links
  for select to authenticated using (public.is_member(business_id));
-- Created and read for customers by the server only (service role).
revoke insert, update, delete on public.document_links from anon, authenticated;
