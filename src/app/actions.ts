"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBusiness } from "@/server/blueprints";

export async function createBusinessAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const name = String(form.get("name") ?? "").trim();
  if (!name || name.length > 80) return { error: "Give your business a name (up to 80 characters)." };
  const timezone = String(form.get("timezone") ?? "UTC") || "UTC";
  const supabase = await createClient();
  let id: string;
  try {
    id = await createBusiness(supabase, { name, timezone });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong" };
  }
  redirect(`/b/${id}`);
}
