-- API key values move into Supabase Vault (encrypted at rest). business_secrets keeps only the
-- name, host, header, prefix and the Vault id. Setting, reading and deleting values goes through
-- functions only the server (service role) can call.

alter table public.business_secrets drop column value;
alter table public.business_secrets add column vault_id uuid not null;

create function public.set_business_secret(bid uuid, p_name text, p_host text, p_header text, p_prefix text, p_value text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  existing uuid;
begin
  if length(coalesce(p_value, '')) not between 1 and 4000 then raise exception 'key value must be 1-4000 characters'; end if;
  select vault_id into existing from public.business_secrets where business_id = bid and name = p_name;
  if existing is not null then
    perform vault.update_secret(existing, p_value);
    update public.business_secrets set host = p_host, header = p_header, prefix = p_prefix where business_id = bid and name = p_name;
  else
    insert into public.business_secrets (business_id, name, host, header, prefix, vault_id)
      values (bid, p_name, p_host, p_header, p_prefix, vault.create_secret(p_value, 'one-app/' || bid || '/' || p_name || '/' || gen_random_uuid(), 'One App API key'));
  end if;
end;
$$;

-- Decrypted values for one business's keys (only for the hosts asked for).
create function public.business_secret_values(bid uuid, p_hosts text[])
returns table (name text, host text, header text, prefix text, value text)
language sql stable security definer set search_path = ''
as $$
  select s.name, s.host, s.header, s.prefix, d.decrypted_secret
  from public.business_secrets s join vault.decrypted_secrets d on d.id = s.vault_id
  where s.business_id = bid and s.host = any (p_hosts);
$$;

-- Removing a key (or its whole business) also removes the encrypted value.
create function public.drop_business_secret_value()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_id;
  return old;
end;
$$;
create trigger business_secrets_vault after delete on public.business_secrets
  for each row execute function public.drop_business_secret_value();

revoke execute on function public.set_business_secret(uuid, text, text, text, text, text), public.business_secret_values(uuid, text[]), public.drop_business_secret_value() from public, anon, authenticated;
grant execute on function public.set_business_secret(uuid, text, text, text, text, text), public.business_secret_values(uuid, text[]) to service_role;
