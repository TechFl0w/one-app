-- Files attached to records (file fields): a private bucket, one folder per business.
-- Path: <business id>/<table id>/<random id>/<file name> (see src/lib/files.ts).
insert into storage.buckets (id, name, public, file_size_limit)
values ('record-files', 'record-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- The first folder must be a business id; a malformed one simply matches nothing.
create or replace function public.record_file_business(object_name text)
returns uuid language sql immutable set search_path = ''
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid end;
$$;

create policy "members read their business's record files" on storage.objects
  for select to authenticated
  using (bucket_id = 'record-files' and public.is_member(public.record_file_business(name)));

create policy "members upload their business's record files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'record-files' and public.is_member(public.record_file_business(name)));

create policy "members remove their business's record files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'record-files' and public.is_member(public.record_file_business(name)));
