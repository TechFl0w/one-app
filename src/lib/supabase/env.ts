const PLACEHOLDER = /your-project|xxx|^$/i;

/** True when real Supabase settings are present (placeholders from .env.example don't count). */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  return !PLACEHOLDER.test(url) && !PLACEHOLDER.test(key) && /^https?:\/\//.test(url);
}

export function supabaseEnv() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase isn't configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see .env.example)");
  }
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! };
}
