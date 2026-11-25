import { describe, expect, it } from "vitest";
import http from "node:http";
import Stripe from "stripe";
import { checkoutParams, interpretEvent } from "./core";

describe("Stripe webhooks", () => {
  const stripe = new Stripe("sk_test_dummy");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({
    id: "evt_1", object: "event", type: "checkout.session.completed", account: "acct_1",
    data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", metadata: { payment_id: "p1" }, payment_intent: "pi_1", subscription: null } },
  });

  it("verifies signatures and turns events into updates", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const event = stripe.webhooks.constructEvent(payload, header, secret);
    expect(interpretEvent(event)).toMatchObject({ kind: "paid", paymentId: "p1", paymentIntent: "pi_1" });
  });

  it("rejects forged or tampered events", () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect(() => stripe.webhooks.constructEvent(payload, header, secret)).toThrow();
    const ok = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(() => stripe.webhooks.constructEvent(payload.replace("p1", "p2"), ok, secret)).toThrow();
  });
});

describe("Stripe API calls", () => {
  it("creates Checkout on the connected account with an idempotency key", async () => {
    const seen: { url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push({ url: req.url, headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const stripe = new Stripe("sk_test_dummy", { host: "localhost", port, protocol: "http", maxNetworkRetries: 0 });
    const params = checkoutParams({ kind: "deposit", amount: 11, currency: "CAD", description: "Deposit", paymentId: "p1", businessId: "b1", successUrl: "https://x/ok", cancelUrl: "https://x/no" });
    const s = await stripe.checkout.sessions.create(params, { stripeAccount: "acct_123", idempotencyKey: "checkout:p1" });
    server.close();
    expect(s.url).toContain("cs_test_1");
    expect(seen[0].url).toBe("/v1/checkout/sessions");
    expect(seen[0].headers["stripe-account"]).toBe("acct_123");
    expect(seen[0].headers["idempotency-key"]).toBe("checkout:p1");
    const body = new URLSearchParams(seen[0].body);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("1100");
    expect(body.get("metadata[payment_id]")).toBe("p1");
    expect(body.get("mode")).toBe("payment");
  });
});
