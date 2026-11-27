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
