import "server-only";
import { idFromKey } from "@/automations/ids";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueDueDates, enqueueForEvent, runDueJobs, type AutomationIO, type Job, type JobQueue } from "@/automations/runner";
import type { RecordEvent } from "@/automations/engine";
import { Blueprint } from "@/schema/blueprint";
import { tableOrThrow, validateRecordInput } from "@/engine/records";
import { getCurrentBlueprint } from "./blueprints";
import { ensureEmailSettings, sendEmail } from "./email";
import { renderTemplate, resolveRecipient } from "@/email/compose";
import { formatDateTime } from "@/components/blocks/format";

/** Supabase implementations of the automation queue and side effects (service role). */

type JobRow = { id: string; business_id: string; automation_id: string; table_id: string; record_id: string; key: string; run_at: string; step: number; attempts: number };
const toJob = (r: JobRow): Job => ({ id: r.id, businessId: r.business_id, automationId: r.automation_id, tableId: r.table_id, recordId: r.record_id, key: r.key, runAt: r.run_at, step: r.step, attempts: r.attempts });

const must = <T>(r: { data: T; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

export function supabaseQueue(db: SupabaseClient): JobQueue {
  return {
    async enqueue(j) {
      const rows = must(
        await db
          .from("automation_jobs")
          .upsert(
            { business_id: j.businessId, automation_id: j.automationId, table_id: j.tableId, record_id: j.recordId, key: j.key, run_at: j.runAt },
            { onConflict: "business_id,key", ignoreDuplicates: true },
          )
          .select("id"),
        "enqueue",
      );
      return (rows ?? []).length > 0;
    },
    async claimDue(now, limit) {
      return (must(await db.rpc("claim_automation_jobs", { p_now: now.toISOString(), p_limit: limit }), "claim") as JobRow[]).map(toJob);
    },
    async finish(id, u) {
      const patch =
        u.status === "queued"
          ? { status: "queued", run_at: u.runAt, step: u.step, attempts: u.attempts, last_error: u.error ?? null, locked_at: null }
          : { status: u.status, locked_at: null };
      must(await db.from("automation_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id), "finish job");
    },
    async logRun(r) {
      must(
        await db.from("automation_runs").insert({
          business_id: r.businessId, automation_id: r.automationId, job_id: r.jobId, record_id: r.recordId, status: r.status, test: r.test, steps: r.steps, error: r.error ?? null,
        }),
        "log run",
      );
    },
  };
}

export function supabaseAutomationIO(db: SupabaseClient): AutomationIO {
  const blueprints = new Map<string, Promise<Blueprint>>(); // per worker run
  const blueprint = (b: string) => {
    if (!blueprints.has(b)) blueprints.set(b, getCurrentBlueprint(db, b));
    return blueprints.get(b)!;
  };
  return {
    blueprint,
    async getRecord(b, t, id) {
      const row = must(await db.from("records").select("data").eq("business_id", b).eq("table_id", t).eq("id", id).maybeSingle(), "load record");
      return (row?.data as Record<string, unknown>) ?? null;
    },
    async recordsWithDate(b, t, field) {
      const rows = must(await db.from("records").select("id, data").eq("business_id", b).eq("table_id", t).not(`data->>${field}`, "is", null).limit(5000), "load dates");
      return (rows ?? []) as { id: string; data: Record<string, unknown> }[];
    },
    async createRecord(b, t, values, key) {
      const data = validateRecordInput(tableOrThrow(await blueprint(b), t), values, "create");
      must(await db.from("records").upsert({ id: idFromKey(key), business_id: b, table_id: t, data }, { onConflict: "id", ignoreDuplicates: true }), "create record");
    },
    async updateRecord(b, t, id, values) {
      const patch = validateRecordInput(tableOrThrow(await blueprint(b), t), values, "update");
      const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null));
      const unset = Object.keys(patch).filter((k) => patch[k] === null);
      must(await db.rpc("patch_record", { p_business_id: b, p_table_id: t, p_record_id: id, p_set: set, p_unset: unset }), "update record");
    },
    async notify(b, message, key, link) {
      must(await db.from("notifications").upsert({ business_id: b, key, message, link }, { onConflict: "business_id,key", ignoreDuplicates: true }), "notify");
    },
    async sendMessage(b, step, key, record) {
      // WhatsApp/SMS arrive with Twilio (Phase 5); until then those steps are skipped.
      if (step.channel !== "email") return { sent: false, reason: `${step.channel === "whatsapp" ? "WhatsApp" : step.channel} isn’t connected yet` };
      const bp = await blueprint(b);
      const to = await resolveRecipient(bp, record.tableId, record.data, step.toField, async (t, id) => {
        const r = await db.from("records").select("data").eq("business_id", b).eq("table_id", t).eq("id", id).maybeSingle();
        return (r.data?.data as Record<string, unknown>) ?? null;
      });
      if (!to) return { sent: false, reason: "No email address for this record" };
      const settings = await ensureEmailSettings(db, b, bp.business.name);
      const table = bp.tables.find((t) => t.id === record.tableId);
      const whenField = table?.fields.find((f) => f.type === "datetime" || f.type === "date");
      const whenValue = whenField && record.data[whenField.id];
      const tracking = table?.fields.find((f) => /track/i.test(f.label) && typeof record.data[f.id] === "string");
      const msg = renderTemplate(step.template, step.message, {
        business: bp.business.name,
        name: to.name?.split(" ")[0],
        when: typeof whenValue === "string" ? formatDateTime(whenValue.length === 10 ? `${whenValue}T12:00:00Z` : whenValue, { timezone: bp.business.timezone }) : undefined,
        tracking: tracking ? String(record.data[tracking.id]) : undefined,
        data: record.data,
      });
      return sendEmail(db, settings, { to: to.email, subject: msg.subject, text: msg.text, key });
    },
  };
}

type EventRow = { id: number; business_id: string; table_id: string; record_id: string; kind: RecordEvent["kind"]; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string };

/** One worker pass: events → jobs, due dates → jobs, then run what's due. */
export async function automationTick(db: SupabaseClient, now = new Date()) {
  const io = supabaseAutomationIO(db);
  const queue = supabaseQueue(db);

  const events = must(await db.from("record_events").select("*").is("processed_at", null).order("id").limit(500), "load events") as EventRow[];
  let queued = 0;
  for (const e of events) {
    queued += await enqueueForEvent({ id: String(e.id), businessId: e.business_id, tableId: e.table_id, recordId: e.record_id, kind: e.kind, before: e.before, after: e.after, at: e.at }, io, queue);
    must(await db.from("record_events").update({ processed_at: now.toISOString() }).eq("id", e.id), "mark event");
  }

  const current = must(await db.from("current_blueprints").select("business_id, json"), "load blueprints") as { business_id: string; json: unknown }[];
  for (const c of current) {
    const bp = Blueprint.safeParse(c.json);
    if (bp.success && bp.data.automations.some((a) => a.enabled && a.trigger.type === "date_reached")) {
      queued += await enqueueDueDates(c.business_id, io, queue, now);
    }
  }

  const runs = await runDueJobs(io, queue, now);
  return { events: events.length, queued, ran: runs.length, failed: runs.filter((r) => r.status === "failed").length };
}
