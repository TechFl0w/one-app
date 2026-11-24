import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { checkoutParams, depositAmount, fromMinor, interpretEvent, platformFee, toMinor } from "./core";

describe("amounts", () => {
  it("converts to minor units, including zero-decimal currencies", () => {
    expect(toMinor(19.99, "CAD")).toBe(1999);
    expect(toMinor(0.1 + 0.2, "usd")).toBe(30);
    expect(toMinor(1500, "JPY")).toBe(1500);
    expect(fromMinor(1999, "CAD")).toBe(19.99);
  });

  it("computes deposits", () => {
    expect(depositAmount(55, { kind: "percent", value: 20 })).toBe(11);
    expect(depositAmount(48, { kind: "percent", value: 33 })).toBe(15.84);
    expect(depositAmount(10, { kind: "fixed", value: 25 })).toBe(10); // never above the price
    expect(depositAmount(null, { kind: "fixed", value: 25 })).toBe(25);
    expect(depositAmount(null, { kind: "percent", value: 20 })).toBeNull();
    expect(depositAmount(55, undefined)).toBeNull();
  });

  it("takes a platform fee only when configured, capped", () => {
    expect(platformFee(1000, 0)).toBeUndefined();
    expect(platformFee(1000, 2.5)).toBe(25);
    expect(platformFee(1000, 90)).toBe(200);
  });
});

describe("checkoutParams", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const base = { amount: 11, currency: "CAD", description: "Deposit: Gel manicure", paymentId: "p1", businessId: "b1", successUrl: "https://x/ok", cancelUrl: "https://x/no" };

  it("builds a deposit payment that expires no sooner than Stripe allows", () => {
    const p = checkoutParams({ ...base, kind: "deposit", expiresAt: new Date(now.getTime() + 15 * 60_000) }, now);
    expect(p).toMatchObject({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: "cad", unit_amount: 1100, product_data: { name: "Deposit: Gel manicure" } } }],
      client_reference_id: "p1",
      metadata: { payment_id: "p1", business_id: "b1", kind: "deposit" },
      payment_intent_data: { metadata: { payment_id: "p1" } },
    });
    expect(p.expires_at).toBe(Math.floor((now.getTime() + 30.5 * 60_000) / 1000));
    expect(p.payment_intent_data).not.toHaveProperty("application_fee_amount");
  });

  it("builds a weekly subscription", () => {
    const p = checkoutParams({ ...base, amount: 250, kind: "subscription", interval: "week", description: "Chair rent" }, now);
    expect(p.mode).toBe("subscription");
    expect(p.line_items![0].price_data!.recurring).toEqual({ interval: "week" });
    expect(p.subscription_data?.metadata?.payment_id).toBe("p1");
    expect(p).not.toHaveProperty("payment_intent_data");
  });

  it("refuses amounts below Stripe's minimum", () => {
    expect(() => checkoutParams({ ...base, amount: 0.2, kind: "payment" }, now)).toThrow(/too small/);
  });
});

describe("interpretEvent", () => {
  const ev = (type: string, object: unknown) => ({ type, data: { object } }) as unknown as Stripe.Event;
  it("maps the events we care about", () => {
    expect(interpretEvent(ev("checkout.session.completed", { id: "cs_1", payment_status: "paid", metadata: { payment_id: "p1" }, payment_intent: "pi_1", subscription: null }))).toEqual({
      kind: "paid", paymentId: "p1", sessionId: "cs_1", paymentIntent: "pi_1", subscription: undefined,
    });
    expect(interpretEvent(ev("checkout.session.completed", { id: "cs_1", payment_status: "unpaid", metadata: { payment_id: "p1" } }))).toBeNull();
    expect(interpretEvent(ev("checkout.session.expired", { client_reference_id: "p2", metadata: {} }))).toEqual({ kind: "expired", paymentId: "p2" });
    expect(interpretEvent(ev("charge.refunded", { refunded: true, payment_intent: "pi_9" }))).toEqual({ kind: "refunded", paymentIntent: "pi_9" });
    expect(interpretEvent(ev("account.updated", { id: "acct_1", charges_enabled: true, payouts_enabled: false, details_submitted: true }))).toMatchObject({ kind: "account", chargesEnabled: true });
    expect(interpretEvent(ev("invoice.paid", {}))).toBeNull();
  });
});
