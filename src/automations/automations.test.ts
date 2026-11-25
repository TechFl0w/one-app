import { describe, expect, it } from "vitest";
import { Blueprint, type Automation } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import { dueAt, fillTemplate, matchEvent, parseDuration, retryDelayMs, type RecordEvent } from "./engine";
import { enqueueDueDates, enqueueForEvent, runDueJobs, testAutomation } from "./runner";
import { memoryIO, memoryQueue } from "./memory";

const BOOKING = "00000000-0000-4000-8000-000000000031";

/** Demo salon plus a few automations covering each trigger and action kind. */
function blueprint(extra: Partial<Automation>[] = []): Blueprint {
  const automations: Automation[] = [
    ...demoBlueprint.automations.filter((a) => a.id === "aut_reminder"), // date_reached fld_start -24h, if booked → message
    {
      id: "aut_thanks",
      label: "Thank you after a visit",
      enabled: true,
      trigger: { type: "status_changed", table: "tbl_bookings", field: "fld_status", to: "opt_done" },
      conditions: [],
      actions: [
        { type: "notify", message: "Booking {{record.id}} done ({{fld_amount}})" },
        { type: "wait", duration: "2h" },
        { type: "send_message", channel: "email", template: "tpl_thanks" },
      ],
    },
    {
      id: "aut_new_client",
      label: "Welcome new clients",
      enabled: true,
      trigger: { type: "record_created", table: "tbl_clients" },
      conditions: [{ field: "fld_vip", op: "eq", value: true }],
      actions: [{ type: "create_record", table: "tbl_bookings", values: { fld_client: "{{record.id}}", fld_start: "2026-12-01T17:00:00.000Z", fld_status: "opt_requested" } }, { type: "ai_step" }],
    },
    ...(extra as Automation[]),
  ];
  return Blueprint.parse({ ...demoBlueprint, automations });
}

const ev = (e: Partial<RecordEvent>): RecordEvent => ({
  id: "ev1", businessId: "b1", tableId: "tbl_bookings", recordId: BOOKING, kind: "updated", before: {}, after: {}, at: "2026-11-24T10:00:00.000Z", ...e,
});

describe("engine", () => {
  it("parses durations and computes due dates", () => {
    expect(parseDuration("-24h")).toBe(-86_400_000);
    expect(parseDuration("+21d")).toBe(21 * 86_400_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("soon")).toBeNull();
    const reminder = demoBlueprint.automations[0];
    expect(dueAt(reminder, { fld_start: "2026-12-02T17:00:00.000Z" })?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(dueAt(reminder, {})).toBeNull();
  });

  it("matches events by trigger, changed field, target status and conditions", () => {
    const bp = blueprint();
    const done = ev({ before: { fld_status: "opt_booked" }, after: { fld_status: "opt_done" } });
    expect(matchEvent(bp, done).map((a) => a.id)).toEqual(["aut_thanks"]);
    expect(matchEvent(bp, ev({ before: { fld_status: "opt_requested" }, after: { fld_status: "opt_booked" } }))).toEqual([]);
    expect(matchEvent(bp, ev({ before: { fld_notes: "a", fld_status: "opt_done" }, after: { fld_notes: "b", fld_status: "opt_done" } }))).toEqual([]);
    const vip = ev({ tableId: "tbl_clients", kind: "created", before: null, after: { fld_name: "Zoe", fld_vip: true } });
    expect(matchEvent(bp, vip).map((a) => a.id)).toEqual(["aut_new_client"]);
    expect(matchEvent(bp, { ...vip, after: { fld_name: "Zoe" } })).toEqual([]);
    const off = Blueprint.parse({ ...bp, automations: bp.automations.map((a) => ({ ...a, enabled: false })) });
    expect(matchEvent(off, done)).toEqual([]);
  });

  it("fills templates", () => {
    expect(fillTemplate("Hi {{fld_name}} ({{record.id}}) {{fld_none}}!", "r1", { fld_name: "Ava" })).toBe("Hi Ava (r1) !");
  });

  it("backs off exponentially", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([60_000, 240_000, 960_000]);
  });
});

describe("runner", () => {
  it("queues each event once and runs steps, pausing on wait", async () => {
    const bp = blueprint();
    const { io, effects } = memoryIO(bp, [{ id: BOOKING, tableId: "tbl_bookings", data: { fld_status: "opt_done", fld_amount: 48 } }]);
    const { queue, jobs, runs } = memoryQueue();
    const e = ev({ before: { fld_status: "opt_booked" }, after: { fld_status: "opt_done" } });
    expect(await enqueueForEvent(e, io, queue)).toBe(1);
    expect(await enqueueForEvent(e, io, queue)).toBe(0); // idempotent

    await runDueJobs(io, queue, new Date("2026-11-24T10:00:00Z"));
    expect(effects.map((x) => [x.kind, x.detail])).toEqual([["notify", `Booking ${BOOKING} done (48)`]]);
    expect(runs[0]).toMatchObject({ status: "waiting", steps: [{ outcome: "done" }, { outcome: "waiting" }] });
    expect(jobs[0]).toMatchObject({ status: "queued", step: 2, runAt: "2026-11-24T12:00:00.000Z" });

    expect(await runDueJobs(io, queue, new Date("2026-11-24T11:00:00Z"))).toEqual([]); // not due yet
    await runDueJobs(io, queue, new Date("2026-11-24T12:00:01Z"));
    expect(effects.map((x) => x.kind)).toEqual(["notify", "send_message"]);
    expect(jobs[0].status).toBe("done");
  });

  it("retries failures with backoff without repeating finished steps, then gives up", async () => {
    const bp = blueprint();
    const { io, effects, failNextCalls } = memoryIO(bp, [{ id: BOOKING, tableId: "tbl_bookings", data: { fld_status: "opt_done" } }]);
    const { queue, jobs, runs } = memoryQueue();
    await enqueueForEvent(ev({ before: { fld_status: "opt_booked" }, after: { fld_status: "opt_done" } }), io, queue);

    failNextCalls(1);
    const t0 = new Date("2026-11-24T10:00:00Z");
    await runDueJobs(io, queue, t0);
    expect(runs[0]).toMatchObject({ status: "retrying", error: "temporary failure" });
    expect(jobs[0]).toMatchObject({ status: "queued", attempts: 1, step: 0, runAt: "2026-11-24T10:01:00.000Z" });
    await runDueJobs(io, queue, new Date("2026-11-24T10:01:00Z"));
    expect(effects.filter((x) => x.kind === "notify")).toHaveLength(1);

    // A job that keeps failing ends as failed after MAX_ATTEMPTS.
    const { queue: q2, jobs: j2, runs: r2 } = memoryQueue();
    await enqueueForEvent(ev({ id: "ev2", before: { fld_status: "opt_booked" }, after: { fld_status: "opt_done" } }), io, q2);
    failNextCalls(99);
    let now = t0.getTime();
    for (let i = 0; i < 6; i++) {
      await runDueJobs(io, q2, new Date(now));
      now += 2 * 3_600_000;
    }
    expect(j2[0].status).toBe("failed");
    expect(r2.map((r) => r.status)).toEqual(["retrying", "retrying", "retrying", "retrying", "failed"]);
  });

  it("skips jobs whose record, automation or conditions changed", async () => {
    const bp = blueprint();
    const records = [{ id: BOOKING, tableId: "tbl_bookings", data: { fld_status: "opt_done" } as Record<string, unknown> }];
    const { io } = memoryIO(bp, records);
    const { queue, runs } = memoryQueue();
    await enqueueForEvent(ev({ before: { fld_status: "opt_booked" }, after: { fld_status: "opt_done" } }), io, queue);
    records.length = 0;
    await runDueJobs(io, queue, new Date("2026-11-24T10:00:00Z"));
    expect(runs[0]).toMatchObject({ status: "skipped", error: "The record was deleted" });
  });

  it("schedules date triggers in a window, honours conditions, and reschedules when the date moves", async () => {
    const bp = blueprint();
    const records = [
      { id: BOOKING, tableId: "tbl_bookings", data: { fld_start: "2026-11-25T17:00:00.000Z", fld_status: "opt_booked" } as Record<string, unknown> },
      { id: "00000000-0000-4000-8000-000000000032", tableId: "tbl_bookings", data: { fld_start: "2026-12-20T17:00:00.000Z", fld_status: "opt_booked" } },
      { id: "00000000-0000-4000-8000-000000000033", tableId: "tbl_bookings", data: { fld_start: "2026-11-24T12:00:00.000Z", fld_status: "opt_booked" } }, // reminder time long past
    ];
    const { io } = memoryIO(bp, records);
    const { queue, jobs, runs } = memoryQueue();
    const now = new Date("2026-11-24T10:00:00Z");
    expect(await enqueueDueDates("b1", io, queue, now)).toBe(1);
    expect(jobs[0]).toMatchObject({ recordId: BOOKING, runAt: "2026-11-24T17:00:00.000Z" });

    // The booking moves a day later: old job is skipped when due; a new one gets queued.
    records[0].data = { ...records[0].data, fld_start: "2026-11-26T17:00:00.000Z" };
    await runDueJobs(io, queue, new Date("2026-11-24T17:00:00Z"));
    expect(runs[0]).toMatchObject({ status: "skipped", error: "The date changed; a new run is scheduled" });
    expect(await enqueueDueDates("b1", io, queue, new Date("2026-11-25T10:00:00Z"))).toBe(1);

    // "auto" channel: sent (by email until WhatsApp is connected).
    await runDueJobs(io, queue, new Date("2026-11-25T17:00:00Z"));
    expect(runs[1]).toMatchObject({ status: "done", steps: [{ outcome: "done" }] });
  });

  it("test mode explains what would happen without doing it", () => {
    const bp = blueprint();
    const a = bp.automations.find((x) => x.id === "aut_new_client")!;
    const r = testAutomation(bp, a, { id: "rec1", data: { fld_name: "Zoe", fld_vip: true } });
    expect(r).toEqual({
      matches: true,
      steps: ['Add a booking (Client = "rec1", Start = "2026-12-01T17:00:00.000Z", Status = "Requested")', "ai_step: This step isn’t available yet"],
    });
    expect(testAutomation(bp, a, { id: "rec1", data: { fld_vip: false } }).matches).toBe(false);
  });
});

describe("idFromKey", () => {
  it("is a deterministic valid uuid", async () => {
    const { idFromKey } = await import("./ids");
    const a = idFromKey("job_1:0");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idFromKey("job_1:0")).toBe(a);
    expect(idFromKey("job_1:1")).not.toBe(a);
  });
});

describe("describeTrigger", () => {
  it("says what starts an automation in plain words", async () => {
    const { describeTrigger } = await import("./engine");
    const bp = blueprint();
    const by = (id: string) => describeTrigger(bp, bp.automations.find((a) => a.id === id)!);
    expect(by("aut_reminder")).toBe("1 day before a booking’s Start");
    expect(by("aut_thanks")).toBe("When a booking’s Status changes to Done");
    expect(by("aut_new_client")).toBe("When a client is added");
  });
});

describe("guards", () => {
  it("skips a rebooking nudge when the client already booked again", async () => {
    const bp = Blueprint.parse({ ...demoBlueprint });
    const rebook = bp.automations.find((a) => a.id === "aut_rebook")!;
    expect(rebook.guards).toEqual(["no_upcoming_booking"]);
    const done = { id: BOOKING, tableId: "tbl_bookings", data: { fld_client: "c1", fld_start: "2026-11-01T17:00:00.000Z", fld_status: "opt_done" } as Record<string, unknown> };
    for (const upcoming of [true, false]) {
      const { io } = memoryIO(bp, [done]);
      io.hasUpcomingBooking = async () => upcoming;
      const { queue, runs } = memoryQueue();
      expect(await enqueueDueDates("b1", io, queue, new Date("2026-11-22T16:30:00Z"))).toBe(1); // due 21 days after
      await runDueJobs(io, queue, new Date("2026-11-22T17:00:00Z"));
      expect(runs[0].status).toBe(upcoming ? "skipped" : "done");
      if (upcoming) expect(runs[0].error).toBe("They already have a booking coming up");
    }
  });
});
