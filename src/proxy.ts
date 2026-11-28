import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, supabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/auth"];

/** Refreshes the Supabase session cookie on every request and sends signed-out users to /login. */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The demo and the onboarding preview run without a session or database.
  // /demo?type=mechanic picks which business type the demo shows (remembered in a cookie).
  if (path === "/demo" && request.nextUrl.searchParams.has("type")) {
    const res = NextResponse.redirect(new URL("/demo", request.url));
    res.cookies.set("demo_type", request.nextUrl.searchParams.get("type")!.replace(/[^a-z_]/g, "").slice(0, 30), { path: "/demo", sameSite: "lax" });
    return res;
  }
  if (path === "/demo" || path.startsWith("/demo/") || path === "/start" || path.startsWith("/book/") || path.startsWith("/s/") || path.startsWith("/d/") || path === "/paid") return NextResponse.next();
  // Cron routes (CRON_SECRET) and webhooks (signatures) authenticate themselves, not with a session.
  if (path.startsWith("/api/cron/") || path.startsWith("/api/webhooks/") || path.startsWith("/api/hooks/") || path.startsWith("/api/cal/") || path === "/api/fn/kit") return NextResponse.next(); // signed or token, no session
  // Sandbox runtime files for generated components (static, public).
  if (path.startsWith("/sandbox/")) return NextResponse.next();
  // The MCP server checks its own bearer tokens; discovery documents are public.
  if (path === "/api/mcp" || path.startsWith("/api/mcp/") || path.startsWith("/api/oauth-metadata") || path.startsWith("/.well-known/")) return NextResponse.next();
  // Supabase falls back to the Site URL (/?code=…) for confirmation links: finish sign-in there too.
  if (path === "/" && request.nextUrl.searchParams.has("code")) {
    const to = new URL("/auth/callback", request.url);
    to.searchParams.set("code", request.nextUrl.searchParams.get("code")!);
    return NextResponse.redirect(to);
  }
  // Without Supabase configured (local dev), only the demo works.
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/demo", request.url));
  }

  let response = NextResponse.next({ request });
  const { url, key } = supabaseEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "unauthenticated", message: "Sign in first" } }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sandbox/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
