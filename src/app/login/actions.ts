"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; message?: string };

const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });
  if (error) return { error: error.message };
  redirect(safeNext(form.get("next")));
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  // The configured app URL wins: Supabase only redirects to allow-listed URLs, else to its Site URL.
  const origin = (process.env.NEXT_PUBLIC_APP_URL || (await headers()).get("origin") || "").replace(/\/$/, "");
  const { data, error } = await supabase.auth.signUp({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) return { error: error.message };
  // Supabase answers a sign-up for an existing email with a user that has no identities (and sends nothing).
  if (data.user && data.user.identities?.length === 0) return { error: "You already have an account with this email — sign in instead." };
  if (!data.session) return { message: "Check your email to confirm your account." };
  redirect("/");
}

/** Passwordless: emails a one-time sign-in link (also the way back in after a forgotten password). */
export async function sendSignInLink(_prev: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await createClient();
  const origin = (process.env.NEXT_PUBLIC_APP_URL || (await headers()).get("origin") || "").replace(/\/$/, "");
  const next = safeNext(form.get("next"));
  const { error } = await supabase.auth.signInWithOtp({
    email: String(form.get("email") ?? ""),
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  // Same answer whether or not the account exists, so this can't be used to probe emails.
  if (error && !/signups not allowed|user not found/i.test(error.message)) return { error: error.message };
  return { message: "If there’s an account for that email, a sign-in link is on its way." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
