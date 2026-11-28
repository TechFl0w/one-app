import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailFromIdToken, exchangeCode } from "@/integrations/googleCalendar";
import { googleRedirectUri, readState, saveConnection } from "@/server/googleCalendar";

/** Google sends the person back here after they allow access: keep the connection. */
export async function GET(req: NextRequest) {
  const state = readState(req.nextUrl.searchParams.get("state") ?? "");
  if (!state) return new Response("This link has expired — connect again from Settings › Integrations.", { status: 400 });
  const back = (msg: string) => NextResponse.redirect(`${state.origin}/b/${state.businessId}/settings/integrations?google=${msg}#calendar`);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("cancelled");
  try {
    const t = await exchangeCode(code, googleRedirectUri(state.origin));
    if (!t.refresh_token) return back("no_offline_access");
    await saveConnection(createAdminClient(), { businessId: state.businessId, personId: state.personId, userId: state.userId, email: emailFromIdToken(t.id_token), refreshToken: t.refresh_token, accessToken: t.access_token, expiresIn: t.expires_in });
    return back("connected");
  } catch (e) {
    console.error("google connect", e);
    return back("failed");
  }
}
