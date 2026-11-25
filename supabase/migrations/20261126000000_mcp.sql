-- MCP server per business: owner access tokens (hash only), approvals for risky MCP calls,
-- and an 'mcp' source in the audit log.

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null check (length(name) between 1 and 60),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  hint         text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index api_tokens_business_idx on public.api_tokens (business_id, created_at desc);

alter table public.api_tokens enable row level security;
create policy "owners and admins see their tokens" on public.api_tokens
  for select to authenticated using (user_id = auth.uid() and public.has_role(business_id, '{owner,admin}'));
-- Created and revoked by the server (service role) after checking the user's role.
revoke insert, update, delete on public.api_tokens from anon, authenticated;

-- Where a pending action came from: the in-app chat, or an AI app over MCP (shown under Approvals).
alter table public.agent_pending_actions add column origin text not null default 'chat' check (origin in ('chat', 'mcp'));

alter table public.audit_log drop constraint audit_log_source_check;
alter table public.audit_log add constraint audit_log_source_check check (source in ('ui', 'ai', 'undo', 'system', 'mcp'));

create or replace function public.request_source()
returns text language sql stable set search_path = ''
as $$
  select case coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-one-source', 'ui')
    when 'ai' then 'ai' when 'automation' then 'system' when 'mcp' then 'mcp' else 'ui' end;
$$;
