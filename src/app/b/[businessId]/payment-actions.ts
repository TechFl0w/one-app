"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { commitChangeSet, getCurrentBlueprint } from "@/server/blueprints";
import { ensureAccount, onboardingSession, refreshAccount } from "@/server/payments";

/** Owners/admins only — checked as the user before the service role touches Stripe state. */
async function requireManager(businessId: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const uid = claims?.claims.sub as string | undefined;
  const email = claims?.claims.email as string | undefined;
  const { data } = await supabase.from("memberships").select("role").eq("business_id", businessId).eq("user_id", uid ?? "").maybeSingle();
  if (!data || !["owner", "admin"].includes(data.role)) throw new Error("Only owners and admins can set up payments");
  return { supabase, email };
}

/** Client secret for Stripe's embedded onboarding (creates the connected account on first use). */
export async function paymentsOnboardingSecret(businessId: string): Promise<string> {
  const { email } = await requireManager(businessId);
  const admin = createAdminClient();
  const acct = await ensureAccount(admin, businessId, { email, country: process.env.STRIPE_DEFAULT_COUNTRY });
  return onboardingSession(acct.accountId);
}

export async function refreshPaymentsStatus(businessId: string) {
  await requireManager(businessId);
  await refreshAccount(createAdminClient(), businessId);
  revalidatePath(`/b/${businessId}/settings/payments`);
}

export async function saveDepositRule(businessId: string, _prev: { message?: string; ok?: boolean }, form: FormData): Promise<{ message?: string; ok?: boolean }> {
  try {
    const { supabase } = await requireManager(businessId);
    const bp = await getCurrentBlueprint(supabase, businessId);
    if (!bp.scheduling) return { ok: false, message: "Set up bookings first." };
    const kind = String(form.get("kind") ?? "none");
    const value = Number(form.get("value"));
    const deposit = kind === "percent" || kind === "fixed" ? { kind, value } : undefined;
    if (deposit && !(value > 0)) return { ok: false, message: "Enter an amount above zero." };
    const { deposit: _old, ...rest } = bp.scheduling;
    void _old;
    const scheduling = deposit ? { ...rest, deposit } : rest;
    // Saving this form is the owner's explicit confirmation of the (risky) price-related change.
    await commitChangeSet(supabase, businessId, { baseVersion: bp.version, source: "ui", summary: deposit ? "Ask for a deposit on online bookings" : "Stop asking for deposits", ops: [{ op: "setScheduling", scheduling }] }, { confirmed: true });
    revalidatePath(`/b/${businessId}`, "layout");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn’t save." };
  }
}
