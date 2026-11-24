import type Stripe from "stripe";
import type { Scheduling } from "@/schema/blueprint";

/**
 * Pure payment rules: amounts in minor units, deposits, platform fee, and the Checkout Session
 * parameters we create on a business's connected Stripe account (direct charges).
 */

/** Currencies without minor units (Stripe "zero-decimal"). */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);

export const toMinor = (amount: number, currency: string) => Math.round(amount * (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100));
export const fromMinor = (minor: number, currency: string) => minor / (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);

/** Deposit for a price under the business's rule, rounded to cents and never above the price. */
export function depositAmount(price: number | null | undefined, deposit: Scheduling["deposit"]): number | null {
  if (!deposit) return null;
  const amount = deposit.kind === "fixed" ? deposit.value : price ? (price * deposit.value) / 100 : 0;
  const capped = price ? Math.min(amount, price) : amount;
  const rounded = Math.round(capped * 100) / 100;
  return rounded > 0 ? rounded : null;
}

/** Platform fee in minor units from PLATFORM_FEE_PERCENT (default none). */
export function platformFee(minor: number, percent = Number(process.env.PLATFORM_FEE_PERCENT ?? 0)): number | undefined {
  if (!Number.isFinite(percent) || percent <= 0) return undefined;
  return Math.floor((minor * Math.min(percent, 20)) / 100);
}

export type PaymentKind = "deposit" | "payment" | "subscription";

export interface CheckoutInput {
  kind: PaymentKind;
  amount: number;
  currency: string;
  description: string;
  /** Our payments row id, for webhooks. */
  paymentId: string;
  businessId: string;
  successUrl: string;
  cancelUrl: string;
  /** Deposits expire with their hold (Stripe allows 30 min – 24 h). */
  expiresAt?: Date;
  interval?: "week" | "month";
  customerEmail?: string;
  feePercent?: number;
}

export const MIN_CHECKOUT_MINUTES = 30;

export function checkoutParams(i: CheckoutInput, now = new Date()): Stripe.Checkout.SessionCreateParams {
  const unit = toMinor(i.amount, i.currency);
  if (unit < 50) throw new Error("Amount is too small to charge");
  const metadata = { payment_id: i.paymentId, business_id: i.businessId, kind: i.kind };
  const fee = platformFee(unit, i.feePercent);
  const minExpiry = now.getTime() + MIN_CHECKOUT_MINUTES * 60_000 + 30_000;
  const expires = i.expiresAt ? Math.max(i.expiresAt.getTime(), minExpiry) : undefined;
  const base: Stripe.Checkout.SessionCreateParams = {
    mode: i.kind === "subscription" ? "subscription" : "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: i.currency.toLowerCase(),
          unit_amount: unit,
          product_data: { name: i.description.slice(0, 250) },
          ...(i.kind === "subscription" ? { recurring: { interval: i.interval ?? "month" } } : {}),
        },
      },
    ],
    client_reference_id: i.paymentId,
    metadata,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    ...(i.customerEmail ? { customer_email: i.customerEmail } : {}),
    ...(expires ? { expires_at: Math.floor(Math.min(expires, now.getTime() + 24 * 3_600_000 - 60_000) / 1000) } : {}),
  };
  if (i.kind === "subscription") {
    const percent = i.feePercent ?? Number(process.env.PLATFORM_FEE_PERCENT ?? 0);
    base.subscription_data = { metadata, ...(fee ? { application_fee_percent: Math.min(percent, 20) } : {}) };
  } else {
    base.payment_intent_data = { metadata, description: i.description.slice(0, 250), ...(fee ? { application_fee_amount: fee } : {}) };
  }
  return base;
}

/** What a webhook event means for us (null = ignore). */
export type PaymentUpdate =
  | { kind: "paid"; paymentId: string; sessionId: string; paymentIntent?: string; subscription?: string }
  | { kind: "expired"; paymentId: string }
  | { kind: "refunded"; paymentIntent: string }
  | { kind: "account"; accountId: string; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean };

export function interpretEvent(event: Stripe.Event): PaymentUpdate | null {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object as Stripe.Checkout.Session;
      const paymentId = s.metadata?.payment_id ?? s.client_reference_id;
      if (!paymentId || (s.payment_status !== "paid" && s.payment_status !== "no_payment_required")) return null;
      return {
        kind: "paid",
        paymentId,
        sessionId: s.id,
        paymentIntent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id,
        subscription: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
      };
    }
    case "checkout.session.expired": {
      const s = event.data.object as Stripe.Checkout.Session;
      const paymentId = s.metadata?.payment_id ?? s.client_reference_id;
      return paymentId ? { kind: "expired", paymentId } : null;
    }
    case "charge.refunded": {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
      return pi && c.refunded ? { kind: "refunded", paymentIntent: pi } : null;
    }
    case "account.updated": {
      const a = event.data.object as Stripe.Account;
      return { kind: "account", accountId: a.id, chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, detailsSubmitted: !!a.details_submitted };
    }
    default:
      return null;
  }
}
