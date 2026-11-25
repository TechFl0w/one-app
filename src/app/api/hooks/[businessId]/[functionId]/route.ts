import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBlueprint } from "@/server/blueprints";
import { runFunction } from "@/server/functions";

/**
 * Inbound webhooks for generated server functions marked `webhook: true`. The function itself
 * decides what to accept (e.g. checks a shared secret in the query or headers) and what to answer.
 */
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASS_HEADERS = /^(content-type|user-agent|x-[a-z0-9-]+|stripe-signature|webhook-[a-z-]+|svix-[a-z-]+)$/i;

async function handle(req: Request, ctx: RouteContext<"/api/hooks/[businessId]/[functionId]">) {
  const { businessId, functionId } = await ctx.params;
  if (!UUID.test(businessId) || !/^fn_[a-z0-9_]{1,60}$/.test(functionId)) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient("automation");
  const bp = await getCurrentBlueprint(admin, businessId).catch(() => null);
  if (!bp?.functions?.some((f) => f.id === functionId && f.webhook)) return new NextResponse("Not found", { status: 404 });

  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? "" : (await req.text()).slice(0, 200_000);
  let json: unknown;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }
  const headers = Object.fromEntries([...req.headers].filter(([k]) => PASS_HEADERS.test(k)));
  const out = await runFunction(admin, businessId, functionId, {
    trigger: "webhook",
    request: { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body, ...(json !== undefined ? { json } : {}) },
  });
  if (!out.ok) return NextResponse.json({ error: "The handler failed" }, { status: 500 });
  const v = out.value as { status?: unknown; json?: unknown; text?: unknown; headers?: unknown } | null;
  const status = v && typeof v.status === "number" && v.status >= 200 && v.status < 600 ? v.status : 200;
  const extra = v && v.headers && typeof v.headers === "object" ? Object.fromEntries(Object.entries(v.headers as Record<string, unknown>).filter(([k]) => /^[a-z0-9-]{1,40}$/i.test(k) && !/^(set-cookie|location)$/i.test(k)).map(([k, x]) => [k, String(x).slice(0, 500)])) : {};
  if (v && typeof v.text === "string") return new NextResponse(v.text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...extra } });
  return NextResponse.json(v && "json" in v ? v.json : v, { status, headers: extra });
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
