import type { Automation, Blueprint } from "@/schema/blueprint";
import {
  conditionsHold,
  dateJobKey,
  describeStep,
  dueAt,
  eventJobKey,
  matchEvent,
  MAX_ATTEMPTS,
  planStep,
  retryDelayMs,
  type RecordEvent,
  type Step,
} from "./engine";

/**
 * Turns events and due dates into jobs, and runs jobs. Storage and side effects are behind
 * interfaces (Supabase in production, memory in tests). Every effect gets a deterministic key,
 * so retrying a half-finished job never creates a duplicate record, notification or message.
 */

export interface Job {
  id: string;
  businessId: string;
  automationId: string;
  tableId: string;
  recordId: string;
  key: string;
  runAt: string;
  /** Index of the next action to run (wait steps resume here). */
  step: number;
  attempts: number;
}

export type NewJob = Omit<Job, "id" | "step" | "attempts">;

export interface StepLog {
  description: string;
  outcome: "done" | "skipped" | "failed" | "waiting";
  note?: string;
}

export interface RunLog {
  jobId: string | null;
  businessId: string;
  automationId: string;
  recordId: string;
  status: "done" | "waiting" | "retrying" | "failed" | "skipped";
  test: boolean;
  steps: StepLog[];
  error?: string;
}

export interface JobQueue {
  /** Inserts unless a job with the same (business, key) exists. Returns true if inserted. */
  enqueue(job: NewJob): Promise<boolean>;
  /** Atomically claims up to `limit` due jobs (no two workers get the same job). */
  claimDue(now: Date, limit: number): Promise<Job[]>;
  finish(id: string, update: { status: "done" | "failed" | "skipped" } | { status: "queued"; runAt: string; step: number; attempts: number; error?: string }): Promise<void>;
  logRun(run: RunLog): Promise<void>;
}

export interface AutomationIO {
  blueprint(businessId: string): Promise<Blueprint>;
  getRecord(businessId: string, tableId: string, recordId: string): Promise<Record<string, unknown> | null>;
  /** Records of a table that have a value in `field` (for date triggers). */
  recordsWithDate(businessId: string, tableId: string, field: string): Promise<{ id: string; data: Record<string, unknown> }[]>;
  createRecord(businessId: string, tableId: string, values: Record<string, unknown>, key: string): Promise<void>;
  updateRecord(businessId: string, tableId: string, recordId: string, values: Record<string, unknown>, key: string): Promise<void>;
  notify(businessId: string, message: string, key: string, link: { tableId: string; recordId: string }): Promise<void>;
  /** For the no_upcoming_booking guard: does this booking's/client's client have a future booking? */
  hasUpcomingBooking?(businessId: string, record: { tableId: string; recordId: string; data: Record<string, unknown> }, now: Date): Promise<boolean>;
  /** Returns a reason when the message can't be sent (e.g. channel not connected yet). */
  sendMessage(businessId: string, step: Extract<Step, { kind: "send_message" }>, key: string, record: { tableId: string; recordId: string; data: Record<string, unknown> }): Promise<{ sent: true } | { sent: false; reason: string }>;
  /** Runs a generated server function in its sandbox. Throws on failure (the job retries). */
  runFunction?(businessId: string, functionId: string, key: string, record: { tableId: string; recordId: string; data: Record<string, unknown> }): Promise<{ ran: true; note?: string } | { ran: false; reason: string }>;
}

// ---------- scheduling ----------

/** Queues jobs for event-triggered automations. Returns how many were new. */
export async function enqueueForEvent(e: RecordEvent, io: AutomationIO, queue: JobQueue): Promise<number> {
  const bp = await io.blueprint(e.businessId);
  let n = 0;
  for (const a of matchEvent(bp, e)) {
    if (await queue.enqueue({ businessId: e.businessId, automationId: a.id, tableId: e.tableId, recordId: e.recordId, key: eventJobKey(a, e), runAt: e.at })) n++;
  }
  return n;
}

/** Dates further in the past than this aren't run (e.g. a reminder for a booking made last minute). */
export const LOOKBACK_MS = 60 * 60_000;

/**
 * Queues date_reached jobs due between now - LOOKBACK and now + horizon. Keys include the date
 * value, so rescheduling a booking queues a fresh job and the old one is skipped at run time.
 */
export async function enqueueDueDates(businessId: string, io: AutomationIO, queue: JobQueue, now: Date, horizonMs = 24 * 3_600_000): Promise<number> {
  const bp = await io.blueprint(businessId);
  let n = 0;
  for (const a of bp.automations) {
    if (!a.enabled || a.trigger.type !== "date_reached" || !a.trigger.table || !a.trigger.field) continue;
    for (const r of await io.recordsWithDate(businessId, a.trigger.table, a.trigger.field)) {
      const due = dueAt(a, r.data);
      if (!due || due.getTime() < now.getTime() - LOOKBACK_MS || due.getTime() > now.getTime() + horizonMs) continue;
      if (await queue.enqueue({ businessId, automationId: a.id, tableId: a.trigger.table, recordId: r.id, key: dateJobKey(a, r.id, r.data), runAt: due.toISOString() })) n++;
    }
  }
  return n;
}

// ---------- running ----------

export async function runJob(job: Job, io: AutomationIO, queue: JobQueue, now: Date): Promise<RunLog> {
  const base = { jobId: job.id, businessId: job.businessId, automationId: job.automationId, recordId: job.recordId, test: false };
  const finishSkipped = async (why: string) => {
    await queue.finish(job.id, { status: "skipped" });
    const run: RunLog = { ...base, status: "skipped", steps: [], error: why };
    await queue.logRun(run);
    return run;
  };

  let bp: Blueprint;
  let data: Record<string, unknown> | null;
  try {
    bp = await io.blueprint(job.businessId);
    data = await io.getRecord(job.businessId, job.tableId, job.recordId);
  } catch (e) {
    return retryOrFail(job, queue, base, [], e, now);
  }
  const automation = bp.automations.find((a) => a.id === job.automationId);
  if (!automation) return finishSkipped("The automation was removed");
  if (!automation.enabled) return finishSkipped("The automation is turned off");
  if (!data) return finishSkipped("The record was deleted");
  const table = bp.tables.find((t) => t.id === job.tableId);
  if (!table) return finishSkipped("The table was removed");

  if (job.step === 0) {
    // Re-check at run time: the record may have changed since the job was queued.
    if (automation.trigger.type === "date_reached" && dateJobKey(automation, job.recordId, data) !== job.key) return finishSkipped("The date changed; a new run is scheduled");
    if (!conditionsHold(automation, table, data)) return finishSkipped("Conditions no longer match");
    if (automation.guards?.includes("no_upcoming_booking") && io.hasUpcomingBooking) {
      try {
        if (await io.hasUpcomingBooking(job.businessId, { tableId: job.tableId, recordId: job.recordId, data }, now)) return finishSkipped("They already have a booking coming up");
      } catch (e) {
        return retryOrFail(job, queue, base, [], e, now);
      }
    }
  }

  const steps: StepLog[] = [];
  for (let i = job.step; i < automation.actions.length; i++) {
    const step = planStep(automation.actions[i], { tableId: job.tableId, recordId: job.recordId, data, automation });
    const description = describeStep(bp, step);
    const key = `${job.id}:${i}`;
    try {
      switch (step.kind) {
        case "wait": {
          const runAt = new Date(now.getTime() + step.ms).toISOString();
          await queue.finish(job.id, { status: "queued", runAt, step: i + 1, attempts: 0 });
          steps.push({ description, outcome: "waiting", note: `until ${runAt}` });
          const run: RunLog = { ...base, status: "waiting", steps };
          await queue.logRun(run);
          return run;
        }
        case "create_record":
          await io.createRecord(job.businessId, step.table, step.values, key);
          steps.push({ description, outcome: "done" });
          break;
        case "update_record":
          await io.updateRecord(job.businessId, step.table, step.recordId, step.values, key);
          data = { ...data, ...step.values };
          steps.push({ description, outcome: "done" });
          break;
        case "notify":
          await io.notify(job.businessId, step.message, key, { tableId: job.tableId, recordId: job.recordId });
          steps.push({ description, outcome: "done" });
          break;
        case "send_message": {
          const r = await io.sendMessage(job.businessId, step, key, { tableId: job.tableId, recordId: job.recordId, data });
          steps.push(r.sent ? { description, outcome: "done" } : { description, outcome: "skipped", note: r.reason });
          break;
        }
        case "run_function": {
          if (!io.runFunction) {
            steps.push({ description, outcome: "skipped", note: "Server code can’t run here" });
            break;
          }
          const r = await io.runFunction(job.businessId, step.function, key, { tableId: job.tableId, recordId: job.recordId, data });
          steps.push(r.ran ? { description, outcome: "done", ...(r.note ? { note: r.note } : {}) } : { description, outcome: "skipped", note: r.reason });
          break;
        }
        case "unsupported":
          steps.push({ description, outcome: "skipped", note: step.reason });
          break;
      }
    } catch (e) {
      // Resume at this step on retry; earlier steps are done (and idempotent anyway).
      return retryOrFail({ ...job, step: i }, queue, base, [...steps, { description, outcome: "failed", note: message(e) }], e, now);
    }
  }
  await queue.finish(job.id, { status: "done" });
  const run: RunLog = { ...base, status: "done", steps };
  await queue.logRun(run);
  return run;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function retryOrFail(job: Job, queue: JobQueue, base: Omit<RunLog, "status" | "steps">, steps: StepLog[], e: unknown, now: Date): Promise<RunLog> {
  const attempts = job.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await queue.finish(job.id, { status: "failed" });
    const run: RunLog = { ...base, status: "failed", steps, error: message(e) };
    await queue.logRun(run);
    return run;
  }
  const runAt = new Date(now.getTime() + retryDelayMs(attempts)).toISOString();
  await queue.finish(job.id, { status: "queued", runAt, step: job.step, attempts, error: message(e) });
  const run: RunLog = { ...base, status: "retrying", steps, error: message(e) };
  await queue.logRun(run);
  return run;
}

/** Runs everything due now. Call from a cron route / worker. */
export async function runDueJobs(io: AutomationIO, queue: JobQueue, now: Date, limit = 50): Promise<RunLog[]> {
  const jobs = await queue.claimDue(now, limit);
  const out: RunLog[] = [];
  for (const job of jobs) out.push(await runJob(job, io, queue, now));
  return out;
}

// ---------- test mode ----------

/** What an automation would do for one record — nothing is changed or sent. */
export function testAutomation(bp: Blueprint, automation: Automation, record: { id: string; data: Record<string, unknown> }): { matches: boolean; steps: string[]; dueAt?: string } {
  const table = bp.tables.find((t) => t.id === automation.trigger.table);
  if (!table) return { matches: false, steps: [] };
  const matches = conditionsHold(automation, table, record.data);
  const steps = automation.actions.map((a) => describeStep(bp, planStep(a, { tableId: table.id, recordId: record.id, data: record.data, automation })));
  const due = dueAt(automation, record.data);
  return { matches, steps, ...(due ? { dueAt: due.toISOString() } : {}) };
}
