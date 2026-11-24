import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyStripeEvent, stripeClient } from "@/server/payments";

/**
 * Stripe webhooks (a Connect endpoint, so events from connected accounts arrive here too).
 * Verified with STRIPE_WEBHOOK_SECRET; handling is idempotent, so Stripe's retries are safe.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  let event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, request.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, result: await applyStripeEvent(createAdminClient("public"), event) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
