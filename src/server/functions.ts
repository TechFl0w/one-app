import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentBlueprint } from "./blueprints";
import { defaultRunner, type FunctionRunner, type SecretRule } from "@/functions/runner";
import type { FunctionOutcome } from "@/functions/harness";

/**
 * Runs a business's generated server function (service role; callers check who may run what).
 * Each run gets a one-time token the VM firewall adds to its calls to One App; the token maps to
 * this business only and stops working when the run ends.
 */
const RUN_TIMEOUT_MS = 30_000;
export const hashRunToken = (t: string) => createHash("sha256").update(t).digest("hex");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");

export function functionsAvailable(): boolean {
  return !!defaultRunner() && !!appUrl();
}

export async function runFunction(
  admin: SupabaseClient,
  businessId: string,
  functionId: string,
  ctx: { trigger: "automation" | "webhook" | "test"; record?: unknown; request?: unknown; input?: unknown },
  /** depth: automation hops behind this run (webhooks and tests start at 1). */
  opts: { runner?: FunctionRunner | null; key?: string; depth?: number } = {},
): Promise<FunctionOutcome & { runId?: string }> {
  const runner = opts.runner === undefined ? defaultRunner() : opts.runner;
  if (!runner || !appUrl()) return { ok: false, error: "Server code can’t run on this server yet", logs: [] };
  if (opts.key) {
    const { data: done } = await admin.from("function_runs").select("id, output").eq("business_id", businessId).eq("key", opts.key).eq("status", "ok").limit(1).maybeSingle();
    if (done) return { ok: true, value: done.output, logs: ["Already ran for this step"], runId: done.id };
  }
  const bp = await getCurrentBlueprint(admin, businessId);
  const fn = bp.functions?.find((f) => f.id === functionId);
  if (!fn) return { ok: false, error: `No server code ${functionId}`, logs: [] };

  // Only keys for hosts this function is allowed to reach (decrypted from Vault by the database).
  const { data: rows, error: keysError } = fn.hosts.length ? await admin.rpc("business_secret_values", { bid: businessId, p_hosts: fn.hosts }) : { data: [], error: null };
  if (keysError) return { ok: false, error: `Couldn’t load API keys: ${keysError.message}`, logs: [] };
  const secrets = (rows ?? []) as SecretRule[];

  const token = randomBytes(32).toString("base64url");
  const { data: run, error } = await admin
    .from("function_runs")
    .insert({ business_id: businessId, function_id: fn.id, trigger: ctx.trigger, key: opts.key ?? null, depth: Math.min(opts.depth ?? 1, 10), token_hash: hashRunToken(token), expires_at: new Date(Date.now() + RUN_TIMEOUT_MS + 60_000).toISOString() })
    .select("id")
    .single();
  if (error || !run) return { ok: false, error: `Couldn’t start: ${error?.message}`, logs: [] };

  let outcome: FunctionOutcome;
  try {
    outcome = await runner.run({
      compiled: fn.compiled,
      input: { kitUrl: `${appUrl()}/api/fn/kit`, ctx: { ...ctx, business: { name: bp.business.name, timezone: bp.business.timezone } } },
      appHost: new URL(appUrl()).host,
      runToken: token,
      hosts: fn.hosts,
      secrets,
      timeoutMs: RUN_TIMEOUT_MS,
    });
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.message : String(e), logs: [] };
  }
  await admin
    .from("function_runs")
    .update({
      status: outcome.ok ? "ok" : "error",
      output: outcome.ok ? (outcome.value as object) : null,
      error: outcome.ok ? null : outcome.error.slice(0, 2000),
      logs: outcome.logs.slice(0, 200),
      finished_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  return { ...outcome, runId: run.id };
}

/** The business (and chain depth) a run token belongs to, while that run is still going. */
export async function runForToken(admin: SupabaseClient, token: string): Promise<{ businessId: string; depth: number } | null> {
  const { data } = await admin
    .from("function_runs")
    .select("business_id, expires_at, status, depth")
    .eq("token_hash", hashRunToken(token))
    .maybeSingle();
  if (!data || data.status !== "running" || Date.parse(data.expires_at) < Date.now()) return null;
  return { businessId: data.business_id, depth: data.depth ?? 1 };
}
