import "server-only";
import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "./env";

/**
 * Service-role client for background work (automation worker). Bypasses RLS, so it's only used
 * by code that scopes every query by business_id itself. Writes are tagged as automation.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!isSupabaseConfigured() || !key) throw new Error("Background jobs need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-one-source": "automation" } },
  });
}
