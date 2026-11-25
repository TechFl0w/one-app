import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Email confirmation / magic-link landing: exchanges the code for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    const next = request.nextUrl.searchParams.get("next") ?? "/";
    const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    if (!error) return NextResponse.redirect(new URL(safe, request.url));
  }
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
