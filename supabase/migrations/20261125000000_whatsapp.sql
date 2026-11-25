-- Customer WhatsApp (Twilio): one line per business, conversations per customer number,
-- their messages, and the business's approved message templates.

create table public.whatsapp_lines (
  business_id       uuid primary key references public.businesses (id) on delete cascade,
  phone_e164        text unique check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  twilio_number_sid text,
  sender_sid        text,
  waba_id           text,
  display_name      text,
  status            text not null default 'none' check (status in ('none', 'number_ready', 'registering', 'online', 'offline', 'failed')),
  last_error        text,
  updated_at        timestamptz not null default now()
);

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  channel          text not null default 'whatsapp' check (channel in ('whatsapp')),
  customer_phone   text not null check (customer_phone ~ '^\+[1-9]\d{7,14}$'),
  customer_name    text,
  -- agent: the customer agent answers. owner: handed over; the owner answers.
  mode             text not null default 'agent' check (mode in ('agent', 'owner')),
  agent_history    jsonb not null default '[]' check (jsonb_typeof(agent_history) = 'array'),
  last_inbound_at  timestamptz,
  last_message_at  timestamptz,
  unread           int not null default 0,
  created_at       timestamptz not null default now(),
  unique (business_id, channel, customer_phone)
);
create index conversations_business_idx on public.conversations (business_id, last_message_at desc);

create table public.conversation_messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  author          text not null check (author in ('customer', 'agent', 'owner', 'automation')),
  body            text not null,
  provider_sid    text unique,
  status          text,
  created_at      timestamptz not null default now()
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, created_at);

create table public.whatsapp_templates (
  business_id  uuid not null references public.businesses (id) on delete cascade,
  template_key text not null check (template_key ~ '^tpl_[a-z0-9_]{1,40}$'),
  content_sid  text not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  updated_at   timestamptz not null default now(),
  primary key (business_id, template_key)
);

alter table public.whatsapp_lines enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.whatsapp_templates enable row level security;

create policy "owners and admins read whatsapp line" on public.whatsapp_lines
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read conversations" on public.conversations
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins take over or hand back" on public.conversations
  for update to authenticated using (public.has_role(business_id, '{owner,admin}')) with check (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read messages" on public.conversation_messages
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read templates" on public.whatsapp_templates
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));

-- Everything is written by the server (service role); owners may only switch mode and clear unread.
revoke insert, update, delete on public.whatsapp_lines, public.conversations, public.conversation_messages, public.whatsapp_templates from anon, authenticated;
grant update (mode, unread) on public.conversations to authenticated;
