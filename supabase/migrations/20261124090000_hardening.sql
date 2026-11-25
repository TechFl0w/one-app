-- Close API access to functions that are only meant for triggers and policies.
-- (Supabase security advisor: SECURITY DEFINER functions callable via /rest/v1/rpc.)

-- Trigger functions fire without EXECUTE; nobody should call them directly.
revoke execute on function public.audit_records(), public.audit_blueprint(), public.audit_confirmations(),
  public.record_event(), public.sync_booking_slot(), public.touch_record()
  from public, anon, authenticated;

-- Policy helpers: signed-in users need them (RLS policies call them as the user); anon doesn't.
revoke execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.is_member(uuid), public.has_role(uuid, public.member_role[]) to authenticated;

-- Internal helpers: query_records/aggregate_records (run as the caller) need records_where.
revoke execute on function public.records_where(jsonb), public.request_source() from public, anon;
grant execute on function public.records_where(jsonb), public.request_source() to authenticated;
