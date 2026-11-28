import { after, NextResponse, type NextRequest } from "next/server";
import twilio from "twilio";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseInbound } from "@/whatsapp/core";
import { handleInboundWhatsApp } from "@/whatsapp/inbound";
import { inboundDeps, signingToken, webhookUrl } from "@/server/whatsapp";

// The customer agent can take longer than Twilio's 15 s webhook timeout: answer Twilio right
// away and do the work after the response.
export const maxDuration = 60;

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Inbound WhatsApp messages (and status callbacks) from Twilio. */
export async function POST(request: NextRequest) {
  if (!process.env.TWILIO_AUTH_TOKEN || !process.env.NEXT_PUBLIC_APP_URL) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const params = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>;
  // Each business's number lives in its own sub-account, which signs with its own token.
  const token = await signingToken(createAdminClient("public"), params.AccountSid);
  if (!token) return NextResponse.json({ error: "unknown account" }, { status: 403 });
  // Twilio signs the public URL it called, so validate against that (not the internal one).
  if (!twilio.validateRequest(token, request.headers.get("x-twilio-signature") ?? "", webhookUrl(), params)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }
  const inbound = parseInbound(params);
  if (inbound && (inbound.body || inbound.numMedia)) {
    after(async () => {
      try {
        await handleInboundWhatsApp(inbound, inboundDeps(createAdminClient("public")));
      } catch (e) {
        console.error("whatsapp inbound failed", e);
      }
    });
  }
  return new NextResponse(EMPTY_TWIML, { headers: { "content-type": "text/xml" } });
}
