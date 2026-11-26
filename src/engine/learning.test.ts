import { describe, expect, it } from "vitest";
import { applyChangeSet } from "./changeSet";
import { insightsFrom, patternsOf, withLearnedFields, type HistoryEntry } from "./learning";
import { sampleRecords } from "./sampleRecords";
import { loadBlockData } from "./blockData";
import { memoryStore } from "./store";
import { withComputed } from "./computed";
import { validateRecordInput, tableOrThrow } from "./records";
import { TEMPLATES } from "@/templates";
import type { ChangeSet } from "@/schema/changeSet";

const mech = TEMPLATES.find((t) => t.id === "mechanic")!.build({ name: "Shop", timezone: "America/Vancouver" }, {}).blueprint;

/** Applies ops like an owner would and returns what history stores. */
function change(bp: typeof mech, ops: ChangeSet["ops"], id: string, businessId: string, source = "ui", undoes?: string): { entry: HistoryEntry; bp: typeof mech } {
  const r = applyChangeSet(bp, { baseVersion: bp.version, source: "ui", ops }, { confirmed: true });
  return { entry: { id, businessId, source, createdAt: `2026-11-2${id.length}T10:00:00Z`, undoes, changeSet: { ops }, inverse: r.inverse }, bp: r.blueprint };
}

describe("learning from owners' changes", () => {
  it("describes changes in words, with labels (also of things since removed)", () => {
    const vinGone = change(mech, [{ op: "removeField", tableId: "tbl_vehicles", fieldId: "fld_v_vin" }], "a", "b1");
    expect(patternsOf(vinGone.entry, vinGone.bp)).toEqual([expect.objectContaining({ kind: "remove", text: "Remove “VIN” from Vehicles" })]);
    const added = change(mech, [{ op: "addField", tableId: "tbl_jobs", field: { id: "fld_j_loaner", label: "Courtesy car", type: "checkbox" } }, { op: "rename", target: { kind: "table", tableId: "tbl_jobs" }, label: "Work orders" }], "b", "b1");
    const p = patternsOf(added.entry, added.bp).map((x) => x.text);
    expect(p).toContain("Add “Courtesy car” (checkbox) to Work orders");
    expect(p).toContain("Rename the table “Jobs” to “Work orders”");
  });

  it("counts businesses per type, ignores undone and system changes", () => {
    const one = change(mech, [{ op: "addField", tableId: "tbl_jobs", field: { id: "fld_j_loaner", label: "Courtesy car", type: "checkbox" } }], "x1", "b1");
    const two = change(mech, [{ op: "addField", tableId: "tbl_jobs", field: { id: "fld_x", label: "courtesy  car", type: "checkbox" } }], "x2", "b2", "ai");
    const undone = change(mech, [{ op: "addField", tableId: "tbl_jobs", field: { id: "fld_y", label: "Towing", type: "checkbox" } }], "x3", "b3");
    const undo = { ...undone.entry, id: "x4", source: "undo", undoes: "x3" };
    const sys = { ...change(mech, [{ op: "setTheme", theme: {} }], "x5", "b3").entry, source: "system" };
    const bps = new Map([["b1", one.bp], ["b2", two.bp], ["b3", undone.bp]]);
    const ins = insightsFrom([{ id: "b1", type: "mechanic" }, { id: "b2", type: "mechanic" }, { id: "b3", type: "mechanic" }, { id: "b4", type: "contractor" }], [one.entry, two.entry, undone.entry, undo, sys], bps);
    expect(ins).toHaveLength(1);
    expect(ins[0]).toMatchObject({ businessType: "mechanic", businesses: 2, byAssistant: 1, kind: "field" });
    expect(ins[0].share).toBeCloseTo(2 / 3);
  });

  it("approved fields join new apps of that type, once, matched by table label", () => {
    const field = { id: "fld_j_loaner", label: "Courtesy car", type: "checkbox" as const };
    const bp = withLearnedFields(mech, [{ tableLabel: "jobs", field }, { tableLabel: "Jobs", field }, { tableLabel: "Nope", field }, { tableLabel: "Jobs", field: { id: "fld_l", label: "Link", type: "link", to: "tbl_jobs" } }]);
    expect(bp.tables.find((t) => t.id === "tbl_jobs")!.fields.filter((f) => f.label === "Courtesy car")).toHaveLength(1);
    expect(bp.tables.find((t) => t.id === "tbl_jobs")!.fields.some((f) => f.label === "Link")).toBe(false);
  });
});

describe("sample records for previews", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s: valid records, every block loads", async (_id, t) => {
    const bp = t.build({ name: "Preview Co", timezone: "America/Vancouver" }, {}).blueprint;
    const rows = sampleRecords(bp, new Date("2026-11-26T18:00:00Z"));
    expect(sampleRecords(bp, new Date("2026-11-26T18:00:00Z"))).toEqual(rows); // same every time
    for (const r of rows) expect(() => validateRecordInput(tableOrThrow(bp, r.tableId), r.data, "create"), `${r.tableId}`).not.toThrow();
    const store = withComputed(memoryStore(rows), bp);
    for (const p of bp.pages) {
      const recordId = p.recordOf ? rows.find((r) => r.tableId === p.recordOf)?.id : undefined;
      for (const b of p.layout.blocks) {
        const d = await loadBlockData(b, bp, store, { recordId });
        expect(d.kind, `${p.id}/${b.id}: ${"message" in d ? d.message : ""}`).not.toBe("error");
      }
    }
  });
});
