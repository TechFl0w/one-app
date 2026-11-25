"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** The owner's decision on an AI app's sign-in request; Supabase Auth issues (or refuses) the code. */
export async function decideAuthorization(authorizationId: string, approve: boolean) {
  const supabase = await createClient();
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId)
    : await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error || !data) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}&error=${encodeURIComponent(error?.message ?? "failed")}`);
  redirect(data.redirect_url);
}
