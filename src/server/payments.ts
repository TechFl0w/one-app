import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Blueprint } from "@/schema/blueprint";
import { checkoutParams, interpretEvent, type CheckoutInput, type PaymentKind } from "@/payments/core";
import { optionFor } from "@/booking/lifecycle";
import { supabaseOwnerBackend } from "./ownerBackend";
import { getCurrentBlueprint } from "./blueprints";

/**
 * Stripe Connect wiring (service role for all writes). Each business has its own connected
 * account; payments are direct charges on it. Without STRIPE_SECRET_KEY nothing here runs and
 * the app falls back to "no deposits / use payment links later".
 */

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments aren’t set up on this server (STRIPE_SECRET_KEY)");
  // STRIPE_API_BASE lets tests point at a fake server.
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  return new Stripe(key, {
    maxNetworkRetries: 2,
    ...(base ? { host: base.hostname, port: base.port || undefined, protocol: base.protocol.replace(":", "") as "http" | "https" } : {}),
  });
}

export interface PaymentAccount {
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export async function getAccount(db: SupabaseClient, businessId: string): Promise<PaymentAccount | null> {
  const { data } = await db.from("business_payments").select("*").eq("business_id", businessId).maybeSingle();
  return data
    ? { accountId: data.stripe_account_id, chargesEnabled: data.charges_enabled, payoutsEnabled: data.payouts_enabled, detailsSubmitted: data.details_submitted }
    : null;
}

/**
 * The business's connected account, created on first use. Stripe-dashboard accounts that pay their
 * own fees, so existing Stripe users can sign in during onboarding (networked onboarding).
 */
export async function ensureAccount(admin: SupabaseClient, businessId: string, opts: { email?: string; country?: string }): Promise<PaymentAccount> {
  const existing = await getAccount(admin, businessId);
  if (existing) return existing;
  const stripe = stripeClient();
  const account = await stripe.accounts.create(
    {
      ...(opts.email ? { email: opts.email } : {}),
      ...(opts.country ? { country: opts.country } : {}),
      controller: { fees: { payer: "account" }, losses: { payments: "stripe" }, stripe_dashboard: { type: "full" } },
      metadata: { business_id: businessId },
    },
    { idempotencyKey: `account:${businessId}` },
  );
  const { error } = await admin
    .from("business_payments")
    .upsert({ business_id: businessId, stripe_account_id: account.id }, { onConflict: "business_id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not save Stripe account: ${error.message}`);
  return (await getAccount(admin, businessId))!;
}

/** Client secret for the embedded onboarding component. */
export async function onboardingSession(accountId: string): Promise<string> {
  const s = await stripeClient().accountSessions.create({ account: accountId, components: { account_onboarding: { enabled: true } } });
  return s.client_secret;
}

/** Pulls the account's current state from Stripe (also updated by the account.updated webhook). */
export async function refreshAccount(admin: SupabaseClient, businessId: string): Promise<PaymentAccount | null> {
  const acct = await getAccount(admin, businessId);
  if (!acct) return null;
  const a = await stripeClient().accounts.retrieve(acct.accountId);
  await admin
    .from("business_payments")
    .update({ charges_enabled: !!a.charges_enabled, payouts_enabled: !!a.payouts_enabled, details_submitted: !!a.details_submitted, updated_at: new Date().toISOString() })
    .eq("business_id", businessId);
  return getAccount(admin, businessId);
}

/**
 * Creates a pending payment and its Stripe Checkout page on the business's account.
 * Returns the URL to send the customer to.
 */
export async function createCheckout(
  admin: SupabaseClient,
  input: Omit<CheckoutInput, "paymentId"> & { tableId?: string; recordId?: string },
): Promise<{ paymentId: string; url: string }> {
  const acct = await getAccount(admin, input.businessId);
  if (!acct?.chargesEnabled) throw new Error("Finish setting up payments first (Settings → Payments)");
  const { data: row, error } = await admin
    .from("payments")
    .insert({
      business_id: input.businessId, table_id: input.tableId ?? null, record_id: input.recordId ?? null, kind: input.kind,
      amount: input.amount, currency: input.currency.toUpperCase(), description: input.description,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not record payment: ${error.message}`);
  const params = checkoutParams({ ...input, paymentId: row.id });
  const session = await stripeClient().checkout.sessions.create(params, { stripeAccount: acct.accountId, idempotencyKey: `checkout:${row.id}` });
  await admin.from("payments").update({ checkout_session_id: session.id, checkout_url: session.url }).eq("id", row.id);
  if (!session.url) throw new Error("Stripe didn’t return a payment page");
  return { paymentId: row.id, url: session.url };
}

/** Refunds a paid payment in full. Risky: callers must have the owner's confirmation. */
export async function refundPayment(admin: SupabaseClient, businessId: string, paymentId: string): Promise<void> {
  const { data: p } = await admin.from("payments").select("*").eq("business_id", businessId).eq("id", paymentId).maybeSingle();
  if (!p || p.status !== "paid" || !p.payment_intent_id) throw new Error("Only paid payments can be refunded");
  const acct = await getAccount(admin, businessId);
  await stripeClient().refunds.create({ payment_intent: p.payment_intent_id }, { stripeAccount: acct!.accountId, idempotencyKey: `refund:${paymentId}` });
  await admin.from("payments").update({ status: "refunded", refunded_at: new Date().toISOString() }).eq("id", paymentId);
}

/** Applies a verified Stripe webhook event. Idempotent: replays change nothing. */
export async function applyStripeEvent(admin: SupabaseClient, event: Stripe.Event): Promise<string> {
  const u = interpretEvent(event);
  if (!u) return "ignored";
  const now = new Date().toISOString();
  switch (u.kind) {
    case "account":
      await admin
        .from("business_payments")
        .update({ charges_enabled: u.chargesEnabled, payouts_enabled: u.payoutsEnabled, details_submitted: u.detailsSubmitted, updated_at: now })
        .eq("stripe_account_id", u.accountId);
      return "account";
    case "expired":
      await admin.from("payments").update({ status: "expired" }).eq("id", u.paymentId).eq("status", "pending");
      return "expired";
    case "refunded":
      await admin.from("payments").update({ status: "refunded", refunded_at: now }).eq("payment_intent_id", u.paymentIntent).neq("status", "refunded");
      return "refunded";
    case "paid": {
      const { data: p } = await admin
        .from("payments")
        .update({ status: "paid", paid_at: now, payment_intent_id: u.paymentIntent ?? null, subscription_id: u.subscription ?? null })
        .eq("id", u.paymentId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();
      if (p?.kind === "deposit" && p.record_id) await confirmDepositBooking(admin, p.business_id, p.table_id, p.record_id);
      return p ? "paid" : "already handled";
    }
  }
}

/** A paid deposit confirms its held booking (if it is still held). */
async function confirmDepositBooking(admin: SupabaseClient, businessId: string, tableId: string, recordId: string) {
  const bp: Blueprint = await getCurrentBlueprint(admin, businessId);
  const sc = bp.scheduling;
  if (!sc || sc.bookings.table !== tableId) return;
  const backend = supabaseOwnerBackend(admin, businessId);
  const current = await admin.from("records").select("data").eq("business_id", businessId).eq("id", recordId).maybeSingle();
  const status = current.data?.data?.[sc.bookings.status];
  if (status !== sc.statuses.held) return; // cancelled meanwhile, or already confirmed
  await backend.updateRecord(tableId, recordId, {
    [sc.bookings.status]: optionFor(sc, "confirmed"),
    ...(sc.bookings.holdUntil ? { [sc.bookings.holdUntil]: null } : {}),
  });
}

export type { PaymentKind };
