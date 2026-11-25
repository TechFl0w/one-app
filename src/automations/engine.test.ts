import { describe, expect, it } from "vitest";


describe("run_function steps", () => {
  it("plans and describes running server code", async () => {
    const { planStep, describeStep } = await import("./engine");
    const { demoBlueprint } = await import("@/demo/salon");
    const bp = { ...demoBlueprint, functions: [{ id: "fn_sync", label: "Sync to Xero", source: "x", compiled: "x", hosts: [] }] };
    const a = { id: "aut_x", label: "x", enabled: true, trigger: { type: "record_created" as const, table: "tbl_bookings" }, conditions: [], actions: [{ type: "run_function" as const, function: "fn_sync" }] };
    const step = planStep(a.actions[0], { tableId: "tbl_bookings", recordId: "r1", data: {}, automation: a });
    expect(step).toEqual({ kind: "run_function", function: "fn_sync" });
    expect(describeStep(bp, step)).toBe("Run Sync to Xero");
  });
});

describe("chain depth", () => {
  it("passes one hop deeper to generated code, so loops can be cut off", async () => {
    const { runJob } = await import("./runner");
    const { memoryIO } = await import("./memory");
    const { demoBlueprint, demoRecords } = await import("@/demo/salon");
    const bp = {
      ...demoBlueprint,
      functions: [{ id: "fn_sync", label: "Sync", source: "x", compiled: "x", hosts: [] }],
      automations: [{ id: "aut_sync", label: "Sync", enabled: true, trigger: { type: "record_updated" as const, table: "tbl_bookings" }, conditions: [], actions: [{ type: "run_function" as const, function: "fn_sync" }] }],
    };
    const m = memoryIO(bp, demoRecords());
    const depths: number[] = [];
    m.io.runFunction = async (_b, _f, _k, _r, depth) => (depths.push(depth), { ran: true });
    const rec = demoRecords().find((r) => r.tableId === "tbl_bookings")!;
    const queue = { enqueue: async () => true, claim: async () => [], finish: async () => {}, logRun: async () => {} };
    await runJob({ id: "j1", businessId: "b", automationId: "aut_sync", tableId: "tbl_bookings", recordId: rec.id, key: "k1", runAt: new Date().toISOString(), step: 0, attempts: 0, depth: 2 }, m.io, queue as never, new Date());
    expect(depths).toEqual([3]);
  });
});
