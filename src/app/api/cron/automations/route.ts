import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { automationTick } from "@/server/automations";

/** Automation worker, called by Vercel Cron (Authorization: Bearer $CRON_SECRET). */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await automationTick(createAdminClient()));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
