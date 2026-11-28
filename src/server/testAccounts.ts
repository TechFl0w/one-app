import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Blueprint } from "@/schema/blueprint";
import { templateById, type Answers } from "@/templates";
import { resolveSeed } from "@/templates/types";
import { createToken } from "./mcp";
import { supabaseOwnerBackend } from "./ownerBackend";
import { supabaseAutomationIO, supabaseQueue } from "./automations";
import { enqueueDueDates, runDueJobs } from "@/automations/runner";
import { runRecurring } from "@/engine/recurring";
import { expireHolds } from "@/booking/service";
import { forgetTestFlag, isTestBusiness, rememberTestFlag } from "./testMode";

/**
 * Test businesses for AI testers (the plan's "test accounts on demand"): made from a template
 * with sample data and an MCP token, removed when done. Their emails and texts are captured,
 * never sent, and their clock can be moved forward on its own to check reminders.
 */

const TESTER_EMAIL = () => process.env.TEST_OWNER_EMAIL ?? "ai-tester@one-app.invalid";

/** The account that owns test businesses (made once). */
async function testerId(admin: SupabaseClient): Promise<string> {
  const email = TESTER_EMAIL();
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const found = data?.users.find((u) => u.email === email);
    if (found) return found.id;
    if (!data || data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "AI tester" } });
  if (error || !data.user) throw new Error(`Could not make the tester account: ${error?.message}`);
  return data.user.id;
}

export async function createTestBusiness(admin: SupabaseClient, input: { template: string; name?: string; timezone?: string; answers?: Answers }) {
  const template = templateById(input.template);
  if (!template) throw new Error(`Unknown template ${input.template}`);
  const uid = await testerId(admin);
  const name = (input.name ?? `Test ${template.label}`).slice(0, 80);
  const timezone = input.timezone ?? "America/Vancouver";
  const built = template.build({ name, timezone }, input.answers ?? {});
  const blueprint = Blueprint.parse({ ...built.blueprint, version: 1, business: { ...built.blueprint.business, name, setupUntil: new Date(Date.now() + 48 * 3_600_000).toISOString() } });
  const { data: biz, error } = await admin.from("businesses").insert({ name, type: blueprint.business.type, timezone, created_by: uid, is_test: true }).select("id").single();
  if (error || !biz) throw new Error(`Could not create it: ${error?.message}`);
  const id = biz.id as string;
  const must = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };
  must(await admin.from("memberships").insert({ business_id: id, user_id: uid, role: "owner" }));
  must(await admin.from("blueprints").insert({ business_id: id, version: 1, json: blueprint, created_by: uid }));
  must(await admin.from("blueprint_history").insert({ business_id: id, from_version: 0, to_version: 1, source: "system", summary: "Created test business", change_set: {}, inverse: {}, created_by: uid }));
  const backend = supabaseOwnerBackend(admin, id);
  const ids = new Map<string, string>();
  let seeded = 0;
  for (const s of built.seed) {
    const row = await backend.createRecord(s.table, resolveSeed(s.data, ids)).catch(() => null);
    if (row && s.ref) ids.set(s.ref, row.id);
    if (row) seeded++;
  }
  const token = await createToken(admin, id, uid, "AI tester");
  rememberTestFlag(id);
  return { businessId: id, name, token, seeded, mcpUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/api/mcp/${id}` };
}

/** Removes a test business and everything in it. Refuses real businesses. */
export async function deleteTestBusiness(admin: SupabaseClient, businessId: string): Promise<boolean> {
  if (!(await isTestBusiness(admin, businessId))) return false;
  const { error } = await admin.from("businesses").delete().eq("id", businessId).eq("is_test", true);
  if (error) throw new Error(error.message);
  forgetTestFlag(businessId);
  return true;
}

/**
 * Moves one test business's clock to `now`: due-date reminders, recurring charges and visits,
 * expired holds and every job due by then run — for this business only.
 */
export async function advanceClock(admin: SupabaseClient, businessId: string, now: Date) {
  if (!(await isTestBusiness(admin, businessId))) throw new Error("Only test businesses can move their clock");
  const io = supabaseAutomationIO(admin);
  const queue = supabaseQueue(admin, businessId);
  const bp = await io.blueprint(businessId);
  const queued = await enqueueDueDates(businessId, io, queue, now, 48 * 3_600_000);
  const backend = supabaseOwnerBackend(admin, businessId);
  const made = bp.recurring?.length ? await runRecurring(bp, { query: (q) => backend.query(q), createRecord: (t, v) => backend.createRecord(t, v), updateRecord: (t, id, v) => backend.updateRecord(t, id, v, { confirmed: true }), deleteRecord: (t, id) => backend.deleteRecord(t, id) }, now) : 0;
  if (bp.scheduling?.statuses.held) await expireHolds(bp, backend, now);
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const batch = await runDueJobs(io, queue, now);
    runs.push(...batch);
    if (batch.length < 50) break;
  }
  return { now: now.toISOString(), queued, recurring: made, ran: runs.length, failed: runs.filter((r) => r.status === "failed").length };
}

/** What the business would have sent (captured, never delivered). */
export async function outbox(admin: SupabaseClient, businessId: string) {
  const { data } = await admin.from("outbound_messages").select("channel, to_address, subject, body_text, status, created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(200);
  return data ?? [];
}
