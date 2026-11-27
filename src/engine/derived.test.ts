import { describe, expect, it } from "vitest";
import { addComputed, queryWithComputed, resolveDateToken, valueMatches } from "./computed";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import { memoryBackend } from "@/agent/memoryBackend";
import { validateRecordInput } from "./records";
import type { RecordRow } from "@/schema/records";

/** A lease whose status follows its dates — never stored, so it can't drift (lessons: status is a cache of dates). */
const leases = {
  id: "tbl_leases",
  label: "Leases",
  primaryField: "fld_tenant",
  fields: [
    { id: "fld_tenant", label: "Tenant", type: "text", required: true },
    { id: "fld_start", label: "Start", type: "date" },
    { id: "fld_end", label: "End", type: "date" },
    { id: "fld_cancelled", label: "Cancelled", type: "checkbox" },
    {
      id: "fld_state", label: "Status", type: "status",
      options: [{ id: "opt_cancelled", label: "Cancelled" }, { id: "opt_upcoming", label: "Upcoming" }, { id: "opt_active", label: "Active" }, { id: "opt_ending", label: "Ending" }, { id: "opt_ended", label: "Ended" }],
      derive: {
        rules: [
          { when: [{ field: "fld_cancelled", op: "eq", value: true }], option: "opt_cancelled" },
          { when: [{ field: "fld_start", op: "gt", value: "@today" }], option: "opt_upcoming" },
          { when: [{ field: "fld_end", op: "lt", value: "@today" }], option: "opt_ended" },
          { when: [{ field: "fld_end", op: "lte", value: "@today+30d" }], option: "opt_ending" },
        ],
        otherwise: "opt_active",
      },
    },
  ],
};
const bp = Blueprint.parse({ ...demoBlueprint, business: { ...demoBlueprint.business, timezone: "UTC" }, tables: [...demoBlueprint.tables, leases] });
const row = (id: string, data: Record<string, unknown>): RecordRow => ({ id, tableId: "tbl_leases", data, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" });
const rows = [
  row("a", { fld_tenant: "A", fld_start: "2026-12-01", fld_end: "2027-05-31" }),
  row("b", { fld_tenant: "B", fld_start: "2026-01-01", fld_end: "2027-01-31" }),
  row("c", { fld_tenant: "C", fld_start: "2026-01-01", fld_end: "2026-12-10" }),
  row("d", { fld_tenant: "D", fld_start: "2025-01-01", fld_end: "2026-11-24" }),
  row("e", { fld_tenant: "E", fld_start: "2026-12-01", fld_end: "2027-05-31", fld_cancelled: true }),
];
const status = async (now: string) => Object.fromEntries((await addComputed(bp, "tbl_leases", rows, async () => [], new Date(now))).map((r) => [r.id, r.data.fld_state]));

describe("statuses that follow dates", () => {
  it("works the status out from the dates on every read", async () => {
    expect(await status("2026-11-25T12:00:00Z")).toEqual({ a: "opt_upcoming", b: "opt_active", c: "opt_ending", d: "opt_ended", e: "opt_cancelled" });
    // Time passes; nothing was written, yet every status is right.
    expect(await status("2027-01-05T12:00:00Z")).toEqual({ a: "opt_active", b: "opt_ending", c: "opt_ended", d: "opt_ended", e: "opt_cancelled" });
  });

  it("can't be set by hand", () => {
    const t = bp.tables.find((x) => x.id === "tbl_leases")!;
    expect(() => validateRecordInput(t, { fld_tenant: "X", fld_state: "opt_active" }, "create")).toThrow(/calculated/);
  });

  it("rejects rules that point at unknown options or at itself", () => {
    const broken = structuredClone(leases);
    broken.fields[4].derive!.rules[0].option = "opt_nope";
    broken.fields[4].derive!.rules[1].when[0].field = "fld_state";
    const r = Blueprint.safeParse({ ...demoBlueprint, tables: [...demoBlueprint.tables, broken] });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message).join("\n")).toMatch(/unknown option opt_nope[\s\S]*depend on itself/);
  });

  it("filters and sorts by a derived status", async () => {
    const { backend } = memoryBackend({ blueprint: bp, records: rows });
    const active = await backend.query({ table: "tbl_leases", filters: [{ field: "fld_state", op: "neq", value: "opt_ended" }], sort: [{ field: "fld_state", dir: "asc" }] });
    expect(active.records.map((r) => r.id)).toEqual(["e", "a", "b", "c"]);
    expect(active.total).toBe(4);
  });

  it("stored-only queries keep the fast path", async () => {
    let calls = 0;
    const r = await queryWithComputed(bp, { table: "tbl_leases", limit: 2 }, async () => (calls++, { records: rows.slice(0, 2), total: 5 }), async () => [], new Date("2026-11-25T12:00:00Z"));
    expect(calls).toBe(1);
    expect(r.total).toBe(5);
    expect(r.records[1].data.fld_state).toBe("opt_active");
  });

  it("reads relative dates", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    expect(resolveDateToken("@today+30d", "2026-11-25", now)).toBe("2026-12-25");
    expect(resolveDateToken("@today-7d", "2026-11-25", now)).toBe("2026-11-18");
    expect(resolveDateToken("opt_x", "2026-11-25", now)).toBe("opt_x");
  });
});

describe("day tokens on date-times (rollups, statuses, automations)", () => {
  // 27 Nov in Vancouver; 3 pm there is 22:00 UTC, 11:30 pm is the next day in UTC.
  const now = new Date("2026-11-27T20:00:00Z");
  const today = "2026-11-27";
  const tz = "America/Vancouver";
  it("eq @today matches any time on the local day", () => {
    expect(valueMatches("2026-11-27T22:00:00.000Z", { field: "f", op: "eq", value: "@today" }, today, now, tz)).toBe(true);
    expect(valueMatches("2026-11-28T06:30:00.000Z", { field: "f", op: "eq", value: "@today" }, today, now, tz)).toBe(true); // 11:30 pm local
    expect(valueMatches("2026-11-28T08:00:00.000Z", { field: "f", op: "eq", value: "@today" }, today, now, tz)).toBe(false);
    expect(valueMatches("2026-11-28T18:00:00.000Z", { field: "f", op: "eq", value: "@tomorrow" }, today, now, tz)).toBe(true);
    expect(valueMatches("2026-11-27", { field: "f", op: "eq", value: "@today" }, today, now, tz)).toBe(true);
  });
  it("ranges and before/after work by local day", () => {
    expect(valueMatches("2026-11-23T17:00:00.000Z", { field: "f", op: "eq", value: "@this_week" }, today, now, tz)).toBe(true); // Monday
    expect(valueMatches("2026-11-22T17:00:00.000Z", { field: "f", op: "eq", value: "@this_week" }, today, now, tz)).toBe(false);
    expect(valueMatches("2026-11-26", { field: "f", op: "lt", value: "@today" }, today, now, tz)).toBe(true);
    expect(valueMatches("2026-11-27T22:00:00.000Z", { field: "f", op: "lt", value: "@today" }, today, now, tz)).toBe(false);
    expect(valueMatches("2026-12-01", { field: "f", op: "gt", value: "@this_month" }, today, now, tz)).toBe(true);
    expect(valueMatches("2026-12-27", { field: "f", op: "lte", value: "@today+30d" }, today, now, tz)).toBe(true);
    expect(valueMatches("2026-12-28", { field: "f", op: "lte", value: "@today+30d" }, today, now, tz)).toBe(false);
  });
});
