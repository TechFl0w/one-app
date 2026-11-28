import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authUrl, googleConfigured } from "@/integrations/googleCalendar";
import { googleRedirectUri, signState } from "@/server/googleCalendar";

/** "Connect Google Calendar": ?business=<id>[&person=<staff record id>] → Google's consent screen. */
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get("business") ?? "";
  const personId = req.nextUrl.searchParams.get("person") || null;
  const back = (msg: string) => NextResponse.redirect(new URL(`/b/${businessId}/settings/integrations?google=${encodeURIComponent(msg)}`, req.url));
  if (!googleConfigured()) return back("not_configured");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub as string | undefined;
  if (!userId) return NextResponse.redirect(new URL("/login", req.url));
  const { data: m } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", userId).maybeSingle();
  if (!m || !["owner", "admin"].includes(m.role)) return back("not_allowed");
  if (personId && !/^[0-9a-f-]{36}$/i.test(personId)) return back("not_allowed");
  // Back to the address they started from (production or a preview), which Google must know.
  const origin = req.nextUrl.origin;
  return NextResponse.redirect(authUrl(googleRedirectUri(origin), signState({ businessId, personId, userId, origin })));
}
