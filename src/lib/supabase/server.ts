import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Supabase client for server components, server actions and route handlers (acts as the signed-in user). */
export async function createClient() {
  const cookieStore = await cookies(); // first, so pages using this are always dynamic
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a server component: cookies are read-only there. The proxy refreshes the session.
        }
      },
    },
  });
}
