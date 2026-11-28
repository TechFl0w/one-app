import { createAdminClient } from "@/lib/supabase/admin";
import { advanceClock } from "@/server/testAccounts";
import { testAuth } from "../../../auth";

/** POST { now: ISO time } (or { hours }): runs everything due by then, for this test business only. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = testAuth(req);
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { now?: string; hours?: number };
  const now = body.now ? new Date(body.now) : new Date(Date.now() + (Number(body.hours) || 24) * 3_600_000);
  if (Number.isNaN(now.getTime())) return Response.json({ error: "now must be an ISO time" }, { status: 400 });
  try {
    return Response.json(await advanceClock(createAdminClient(), id, now));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
