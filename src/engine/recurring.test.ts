import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/templates";
import { memoryBackend } from "@/agent/memoryBackend";
import { dueToCreate, runRecurring } from "./recurring";

describe("recurring charges", () => {
  it("every week / month from the start, up to a few days ahead, not after the end, never twice", () => {
    expect(dueToCreate("2026-11-02", undefined, "week", "2026-11-20", 3, new Set(["2026-11-09"]), "2026-11-01")).toEqual(["2026-11-02", "2026-11-16", "2026-11-23"]);
    expect(dueToCreate("2026-01-31", undefined, "month", "2026-04-29", 3, new Set(), "2026-01-01")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(dueToCreate("2026-11-02", "2026-11-12", "week", "2026-11-30", 3, new Set(), "2026-11-01")).toEqual(["2026-11-02", "2026-11-09"]);
    expect(dueToCreate("2025-01-06", undefined, "week", "2026-11-20", 0, new Set(), "2026-11-06")).toEqual(["2026-11-09", "2026-11-16"]);
  });

  it("chair rent: a signed renter gets weekly charges once; unsigned or ended renters get none", async () => {
    const t = TEMPLATES.find((x) => x.id === "chair_rental")!;
    const { blueprint } = t.build({ name: "Mane Street", timezone: "America/Vancouver" }, { period: "weekly" });
    const { backend } = memoryBackend({ blueprint, records: [] });
    const now = new Date("2026-11-20T18:00:00Z"); // Friday
    const marco = await backend.createRecord("tbl_renters", { fld_name: "Marco", fld_start: "2026-11-16", fld_rent: 250, fld_signed: "2026-11-10" });
    await backend.createRecord("tbl_renters", { fld_name: "Tom", fld_start: "2026-11-16", fld_rent: 250 }); // not signed
    await backend.createRecord("tbl_renters", { fld_name: "Ana", fld_start: "2026-10-05", fld_end: "2026-11-01", fld_rent: 900, fld_signed: "2026-10-01" }); // left
    expect(await runRecurring(blueprint, backend, now)).toBe(2); // 16 Nov and 23 Nov (3 days ahead)
    expect(await runRecurring(blueprint, backend, now)).toBe(0); // never twice
    const charges = (await backend.query({ table: "tbl_rent", limit: 50 })).records;
    expect(charges.map((c) => [c.data.fld_renter, c.data.fld_due, c.data.fld_amount]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([
      [marco.id, "2026-11-16", 250],
      [marco.id, "2026-11-23", 250],
    ]);
  });
});

describe("recurring visits", () => {
  it("a cleaning every 2 weeks at 9:00: copies the plan, keeps the time, skips stay skipped, edits flow to future visits, ending removes untouched ones", async () => {
    const { Blueprint } = await import("@/schema/blueprint");
    const bp = Blueprint.parse({
      version: 1,
      business: { name: "Spark Clean", type: "cleaning", timezone: "America/Vancouver" },
      tables: [
        { id: "tbl_plans", label: "Plans", primaryField: "fld_client", fields: [
          { id: "fld_client", label: "Client", type: "text" },
          { id: "fld_first", label: "First visit", type: "datetime" },
          { id: "fld_until", label: "Until", type: "date" },
          { id: "fld_notes", label: "Notes", type: "text" },
        ] },
        { id: "tbl_visits", label: "Visits", primaryField: "fld_v_client", fields: [
          { id: "fld_v_client", label: "Client", type: "text" },
          { id: "fld_v_plan", label: "Plan", type: "link", to: "tbl_plans" },
          { id: "fld_v_when", label: "When", type: "datetime" },
          { id: "fld_v_notes", label: "Notes", type: "text" },
          { id: "fld_v_status", label: "Status", type: "status", options: [{ id: "opt_planned", label: "Planned" }, { id: "opt_done", label: "Done" }] },
        ] },
      ],
      pages: [], automations: [], connections: [], modules: [],
      recurring: [{ id: "rec_clean", label: "Cleanings", table: "tbl_plans", every: "2weeks", start: "fld_first", end: "fld_until", charges: { table: "tbl_visits", via: "fld_v_plan", due: "fld_v_when" }, copy: [{ from: "fld_client", to: "fld_v_client" }, { from: "fld_notes", to: "fld_v_notes" }], leadDays: 35 }],
    });
    const { backend } = memoryBackend({ blueprint: bp, records: [] });
    const now = new Date("2026-11-27T18:00:00Z");
    // Tuesday 1 Dec 2026, 9:00 in Vancouver (UTC−7 all year there now).
    const plan = await backend.createRecord("tbl_plans", { fld_client: "Hannah", fld_first: "2026-12-01T16:00:00.000Z", fld_notes: "Key under mat" });
    expect(await runRecurring(bp, backend, now)).toBe(3); // 1, 15 and 29 Dec
    const visits = async () => (await backend.query({ table: "tbl_visits", limit: 50 })).records.sort((a, b) => String(a.data.fld_v_when).localeCompare(String(b.data.fld_v_when)));
    expect((await visits()).map((v) => v.data.fld_v_when)).toEqual(["2026-12-01T16:00:00.000Z", "2026-12-15T16:00:00.000Z", "2026-12-29T16:00:00.000Z"]);
    expect((await visits())[0].data).toMatchObject({ fld_v_client: "Hannah", fld_v_notes: "Key under mat" });

    // Skip 15 Dec: it isn't made again.
    await backend.deleteRecord("tbl_visits", (await visits())[1].id);
    expect(await runRecurring(bp, backend, now)).toBe(0);
    // The first visit is done; then the plan's notes change: future, untouched visits follow.
    await backend.updateRecord("tbl_visits", (await visits())[0].id, { fld_v_status: "opt_done" });
    await backend.updateRecord("tbl_plans", plan.id, { fld_notes: "Code 1234" });
    await runRecurring(bp, backend, now);
    expect((await visits()).map((v) => v.data.fld_v_notes)).toEqual(["Key under mat", "Code 1234"]);
    // The plan ends on 20 Dec: the 29 Dec visit goes.
    await backend.updateRecord("tbl_plans", plan.id, { fld_until: "2026-12-20" });
    await runRecurring(bp, backend, now);
    expect((await visits()).map((v) => String(v.data.fld_v_when).slice(0, 10))).toEqual(["2026-12-01"]);
  });
});
