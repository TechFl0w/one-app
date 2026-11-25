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

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
