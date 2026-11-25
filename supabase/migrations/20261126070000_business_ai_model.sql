-- The assistant model a business chose in Settings (null = the app's default). Owners and admins
-- change it through the existing update policy on businesses.
alter table public.businesses
  add column ai_model text check (ai_model in ('claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'));
