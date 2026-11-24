import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailDomains } from "@/email/compose";
import { handleReceived, verifyWebhook, type ReceivedEventData } from "@/email/inbound";
import { inboundDeps } from "@/server/email";

/** Resend webhooks. Only `email.received` is handled; everything else is acknowledged. */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const raw = await request.text();
  let event: { type?: string; data?: ReceivedEventData };
  try {
    event = verifyWebhook(raw, request.headers, secret) as typeof event;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  if (event.type !== "email.received" || !event.data) return NextResponse.json({ ok: true, ignored: event.type });
  try {
    const outcome = await handleReceived(event.data, inboundDeps(createAdminClient()), emailDomains());
    return NextResponse.json({ ok: true, ...outcome });
  } catch (e) {
    console.error(e);
    // 500 makes Resend retry; storing is idempotent by email id.
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
