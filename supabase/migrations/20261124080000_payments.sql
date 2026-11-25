-- Stripe Connect: one connected account per business, and every payment we ask for.
create table public.business_payments (
  business_id       uuid primary key references public.businesses (id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  details_submitted boolean not null default false,
  updated_at        timestamptz not null default now()
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  table_id            text,
  record_id           uuid,
  kind                text not null check (kind in ('deposit', 'payment', 'subscription')),
  amount              numeric(12, 2) not null check (amount > 0),
  currency            text not null check (currency ~ '^[A-Z]{3}$'),
  description         text not null,
  status              text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'refunded', 'failed')),
  checkout_session_id text unique,
  checkout_url        text,
  payment_intent_id   text,
  subscription_id     text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  refunded_at         timestamptz
);
create index payments_business_idx on public.payments (business_id, created_at desc);
create index payments_record_idx on public.payments (business_id, record_id);

alter table public.business_payments enable row level security;
alter table public.payments enable row level security;
create policy "owners and admins read payment account" on public.business_payments
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
create policy "owners and admins read payments" on public.payments
  for select to authenticated using (public.has_role(business_id, '{owner,admin}'));
-- Written by the server only (service role): Stripe state must come from Stripe.
revoke insert, update, delete on public.business_payments, public.payments from anon, authenticated;
