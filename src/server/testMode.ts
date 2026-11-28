import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Test businesses (businesses.is_test): their emails and texts are captured, never sent. */
const cache = new Map<string, { test: boolean; at: number }>();
/** Is this a test business? (Cached for a minute: checked before every email and text.) */
export async function isTestBusiness(db: SupabaseClient, businessId: string): Promise<boolean> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < 60_000) return hit.test;
  const { data } = await db.from("businesses").select("is_test").eq("id", businessId).maybeSingle();
  const test = !!data?.is_test;
  cache.set(businessId, { test, at: Date.now() });
  return test;
}

export const rememberTestFlag = (id: string) => cache.set(id, { test: true, at: Date.now() });
export const forgetTestFlag = (id: string) => cache.delete(id);
