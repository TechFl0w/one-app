import type { Blueprint } from "@/schema/blueprint";
import type { AutomationIO, Job, JobQueue, NewJob, RunLog } from "./runner";

/** In-memory queue + IO for tests (and a reference for the Supabase versions). */

export function memoryQueue() {
  const jobs: (Job & { status: string; error?: string })[] = [];
  const runs: RunLog[] = [];
  let n = 0;
  const queue: JobQueue = {
    async enqueue(j: NewJob) {
      if (jobs.some((x) => x.businessId === j.businessId && x.key === j.key)) return false;
      jobs.push({ ...j, id: `job_${++n}`, step: 0, attempts: 0, status: "queued" });
      return true;
    },
    async claimDue(now, limit) {
      const due = jobs.filter((j) => j.status === "queued" && Date.parse(j.runAt) <= now.getTime()).slice(0, limit);
      due.forEach((j) => (j.status = "running"));
      return due.map((j) => ({ id: j.id, businessId: j.businessId, automationId: j.automationId, tableId: j.tableId, recordId: j.recordId, key: j.key, runAt: j.runAt, step: j.step, attempts: j.attempts }));
    },
    async finish(id, u) {
      const j = jobs.find((x) => x.id === id)!;
      Object.assign(j, u);
    },
    async logRun(r) {
      runs.push(r);
    },
  };
  return { queue, jobs, runs };
}

export function memoryIO(blueprint: Blueprint, records: { id: string; tableId: string; data: Record<string, unknown> }[]) {
  const effects: { kind: string; key: string; detail: unknown }[] = [];
  const done = new Set<string>();
  let failNext = 0;
  const once = (key: string, kind: string, detail: unknown) => {
    if (failNext > 0) {
      failNext--;
      throw new Error("temporary failure");
    }
    if (done.has(key)) return; // idempotent by key
    done.add(key);
    effects.push({ kind, key, detail });
  };
  const io: AutomationIO = {
    blueprint: async () => blueprint,
    getRecord: async (_b, t, id) => records.find((r) => r.tableId === t && r.id === id)?.data ?? null,
    recordsWithDate: async (_b, t, f) => records.filter((r) => r.tableId === t && r.data[f] != null),
    createRecord: async (_b, t, values, key) => once(key, "create_record", { t, values }),
    updateRecord: async (_b, t, id, values, key) => {
      once(key, "update_record", { t, id, values });
      const r = records.find((x) => x.id === id);
      if (r) r.data = { ...r.data, ...values };
    },
    notify: async (_b, message, key) => once(key, "notify", message),
    sendMessage: async (_b, step, key) => {
      if (step.channel === "whatsapp") return { sent: false, reason: "WhatsApp isn’t connected yet" };
      once(key, "send_message", step);
      return { sent: true };
    },
  };
  return { io, effects, records, failNextCalls: (k: number) => (failNext = k) };
}
