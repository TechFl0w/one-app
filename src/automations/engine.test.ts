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
