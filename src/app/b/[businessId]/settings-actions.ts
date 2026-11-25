"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { commitChangeSet, getCurrentBlueprint } from "@/server/blueprints";
import { aiModelInfo, isAiModel } from "@/agent/models";

export type FormResult = { ok?: boolean; message?: string };
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Couldn’t save." });

/** Your name (shown to your team). */
export async function saveProfile(_prev: FormResult, form: FormData): Promise<FormResult> {
  try {
    const name = String(form.get("name") ?? "").trim().slice(0, 100);
    const { error } = await (await createClient()).auth.updateUser({ data: { full_name: name } });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/** A new sign-in email: Supabase sends a confirmation link to the new address first. */
export async function changeEmail(_prev: FormResult, form: FormData): Promise<FormResult> {
  try {
    const email = String(form.get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "That email address doesn’t look right." };
    const { error } = await (await createClient()).auth.updateUser({ email });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: `Check ${email} and click the link to confirm the change.` };
  } catch (e) {
    return fail(e);
  }
}

export async function changePassword(_prev: FormResult, form: FormData): Promise<FormResult> {
  try {
    const password = String(form.get("password") ?? "");
    if (password.length < 8) return { ok: false, message: "Use at least 8 characters." };
    if (password !== String(form.get("confirm") ?? "")) return { ok: false, message: "The two passwords don’t match." };
    const { error } = await (await createClient()).auth.updateUser({ password });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: "Password changed." };
  } catch (e) {
    return fail(e);
  }
}

/** Business details: name, timezone, currency, review link (owners/admins; RLS checks). */
export async function saveBusiness(businessId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  try {
    const supabase = await createClient();
    const bp = await getCurrentBlueprint(supabase, businessId);
    const name = String(form.get("name") ?? "").trim().slice(0, 80);
    const timezone = String(form.get("timezone") ?? "");
    const currency = String(form.get("currency") ?? "").toUpperCase();
    const reviewUrl = String(form.get("reviewUrl") ?? "").trim();
    if (!name) return { ok: false, message: "Give the business a name." };
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      return { ok: false, message: "Pick a timezone." };
    }
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: "Pick a currency." };
    if (reviewUrl && !/^https:\/\//.test(reviewUrl)) return { ok: false, message: "The review link should start with https://" };
    const business = { name, timezone, currency, ...(reviewUrl ? { reviewUrl } : {}) };
    await commitChangeSet(supabase, businessId, { baseVersion: bp.version, source: "ui", summary: "Update business details", ops: [{ op: "updateBusiness", business }] });
    if (name !== bp.business.name) await supabase.from("businesses").update({ name }).eq("id", businessId);
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return fail(e);
  }
}

/** Which assistant model this business uses (owners and admins; RLS enforces it). */
export async function saveAiModel(businessId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  try {
    const model = String(form.get("model") ?? "");
    if (!isAiModel(model)) return { ok: false, message: "Pick a model." };
    const supabase = await createClient();
    const { data, error } = await supabase.from("businesses").update({ ai_model: model }).eq("id", businessId).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) return { ok: false, message: "Only owners and admins can change this." };
    revalidatePath(`/b/${businessId}/settings`);
    return { ok: true, message: `The assistant now uses ${aiModelInfo(model).label}.` };
  } catch (e) {
    return fail(e);
  }
}
