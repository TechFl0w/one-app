"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireManager(businessId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = (claims?.claims.sub as string | undefined) ?? "";
  const { data } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid).maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Only owners and admins can manage API keys");
}

export type KeyState = { ok?: boolean; message?: string };

/** Saves an API key. The value is write-only: nobody (and no code) can read it back through the app. */
export async function saveApiKey(businessId: string, _prev: KeyState, form: FormData): Promise<KeyState> {
  try {
    await requireManager(businessId);
    const name = String(form.get("name") ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const host = String(form.get("host") ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const header = String(form.get("header") ?? "Authorization").trim() || "Authorization";
    const prefixRaw = String(form.get("prefix") ?? "");
    const value = String(form.get("value") ?? "").trim();
    if (!/^[A-Z][A-Z0-9_]{0,39}$/.test(name)) return { ok: false, message: "Name it in capitals, e.g. SHIPPO." };
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return { ok: false, message: "Enter the API’s host, e.g. api.goshippo.com." };
    if (!/^[A-Za-z0-9-]{1,40}$/.test(header)) return { ok: false, message: "That header name doesn’t look right." };
    if (!value) return { ok: false, message: "Paste the key." };
    const prefix = prefixRaw === "none" ? "" : prefixRaw || "Bearer ";
    const { error } = await createAdminClient().from("business_secrets").upsert({ business_id: businessId, name, host, header, prefix, value });
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/b/${businessId}/settings/code`);
    return { ok: true, message: `Saved ${name}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t save." };
  }
}

export async function removeApiKey(businessId: string, name: string) {
  await requireManager(businessId);
  await createAdminClient().from("business_secrets").delete().eq("business_id", businessId).eq("name", name);
  revalidatePath(`/b/${businessId}/settings/code`);
}
