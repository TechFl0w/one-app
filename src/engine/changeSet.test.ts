import { describe, expect, it } from "vitest";
import { applyChangeSet, ChangeSetError, previewChangeSet, undoChangeSet } from "./changeSet";
import { salonBlueprint } from "./__tests__/fixtures";
import type { Automation, Block, Blueprint, Field } from "@/schema/blueprint";
import type { ChangeSet, Operation } from "@/schema/changeSet";

const cs = (bp: Blueprint, ...ops: Operation[]): ChangeSet => ({ baseVersion: bp.version, source: "ui", ops });

function expectError(fn: () => unknown, code: ChangeSetError["code"]) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ChangeSetError);
    expect((e as ChangeSetError).code).toBe(code);
    return e as ChangeSetError;
  }
  throw new Error("expected a ChangeSetError");
}

/** Applying an op then its inverse must give back the original blueprint (apart from version). */
function expectRoundTrip(ops: Operation[], confirmed = true) {
  const before = salonBlueprint();
  const applied = applyChangeSet(before, cs(before, ...ops), { confirmed });
  const undone = undoChangeSet(applied.blueprint, applied.inverse, { confirmed: true });
  expect({ ...undone.blueprint, version: before.version }).toEqual(before);
  expect(undone.blueprint.version).toBe(before.version + 2);
  return applied;
}

describe("applyChangeSet", () => {
  it("bumps the version and never mutates its input", () => {
    const bp = salonBlueprint();
    const snapshot = structuredClone(bp);
    const r = applyChangeSet(bp, cs(bp, { op: "rename", target: { kind: "page", pageId: "pg_today" }, label: "Agenda" }));
    expect(r.blueprint.version).toBe(4);
    expect(r.blueprint.pages[0].label).toBe("Agenda");
    expect(bp).toEqual(snapshot);
  });

  it("renames by id, so references keep working", () => {
    const bp = salonBlueprint();
    const r = applyChangeSet(
      bp,
      cs(
        bp,
        { op: "rename", target: { kind: "table", tableId: "tbl_bookings" }, label: "Appointments" },
        { op: "rename", target: { kind: "field", tableId: "tbl_bookings", fieldId: "fld_start" }, label: "Begins" },
      ),
    );
    expect(r.blueprint.tables[2].label).toBe("Appointments");
    expect(r.blueprint.automations[0].trigger).toMatchObject({ table: "tbl_bookings", field: "fld_start" });
    expect(r.ops.map((o) => o.description)).toEqual([
      "Rename table “Bookings” to “Appointments”",
      "Rename field “Start” to “Begins”",
    ]);
  });

  it("applies ops in order, so later ops can use what earlier ones created", () => {
    const bp = salonBlueprint();
    const r = applyChangeSet(
      bp,
      cs(
        bp,
        { op: "addTable", table: { id: "tbl_services", label: "Services", fields: [] } },
        { op: "addField", tableId: "tbl_services", field: { id: "fld_price", label: "Price", type: "money" } },
        {
          op: "addPage",
          page: { id: "pg_services", label: "Services", menuOrder: 2, hidden: false, layout: { columns: 12, blocks: [] } },
        },
        {
          op: "addBlock",
          pageId: "pg_services",
          block: { id: "blk_services", type: "table", source: { table: "tbl_services" }, x: 0, y: 0, w: 12, h: 4 },
        },
      ),
    );
    expect(r.requiresConfirmation).toBe(false);
    expect(r.blueprint.pages[2].layout.blocks[0].source?.table).toBe("tbl_services");
  });

  it("rejects stale change sets (optimistic concurrency)", () => {
    const bp = salonBlueprint();
    const stale = { ...cs(bp, { op: "setPageHidden", pageId: "pg_today", hidden: true }), baseVersion: 2 };
    expectError(() => applyChangeSet(bp, stale), "conflict");
  });

  it("rejects malformed change sets", () => {
    const bp = salonBlueprint();
    expectError(() => applyChangeSet(bp, { baseVersion: 3, source: "ui", ops: [{ op: "dropDatabase" }] }), "invalid");
    expectError(() => applyChangeSet(bp, { baseVersion: 3, source: "ui", ops: [] }), "invalid");
  });

  it("reports which step failed for unknown ids", () => {
    const bp = salonBlueprint();
    const e = expectError(
      () =>
        applyChangeSet(
          bp,
          cs(
            bp,
            { op: "setPageHidden", pageId: "pg_today", hidden: true },
            { op: "moveBlock", pageId: "pg_today", blockId: "blk_ghost", x: 0, y: 0 },
          ),
        ),
      "not_found",
    );
    expect(e.opIndex).toBe(1);
    expect(e.message).toMatch(/^Step 2: Block blk_ghost not found/);
  });

  it("rejects results that break the blueprint", () => {
    const bp = salonBlueprint();
    // Off the grid
    expectError(() => applyChangeSet(bp, cs(bp, { op: "resizeBlock", pageId: "pg_today", blockId: "blk_cal", w: 13, h: 4 })), "invalid");
    expectError(() => applyChangeSet(bp, cs(bp, { op: "moveBlock", pageId: "pg_today", blockId: "blk_cal", x: 6, y: 0 })), "invalid");
    // Removing a field a block depends on — explained in owner terms
    const e = expectError(
      () => applyChangeSet(bp, cs(bp, { op: "removeField", tableId: "tbl_bookings", fieldId: "fld_amount" }), { confirmed: true }),
      "invalid",
    );
    expect(e.message).toBe("That can’t be removed yet: the number block on page “Today” still uses it. Change or remove that first.");
    // Removing a table others link to
    expect(expectError(() => applyChangeSet(bp, cs(bp, { op: "removeTable", tableId: "tbl_team" }), { confirmed: true }), "invalid").message).toMatch(
      /field “Favourite tech” on “Clients” still uses it/,
    );
    // Duplicate ids
    expectError(
      () => applyChangeSet(bp, cs(bp, { op: "addField", tableId: "tbl_clients", field: { id: "fld_name", label: "x", type: "text" } })),
      "invalid",
    );
  });

  it("requires confirmation for risky ops", () => {
    const bp = salonBlueprint();
    const change = cs(bp, { op: "toggleAutomation", automationId: "aut_reminder", enabled: false });
    const e = expectError(() => applyChangeSet(bp, change), "needs_confirmation");
    expect(e.message).toContain("Turn off automation “Reminder 24h before”");
    expect(applyChangeSet(bp, change, { confirmed: true }).blueprint.automations[0].enabled).toBe(false);
  });

  it("reorders pages by listing every page", () => {
    const bp = salonBlueprint();
    const r = applyChangeSet(bp, cs(bp, { op: "reorderPages", pageIds: ["pg_clients", "pg_today"] }));
    expect(r.blueprint.pages.map((p) => [p.id, p.menuOrder])).toEqual([
      ["pg_today", 1],
      ["pg_clients", 0],
    ]);
    expectError(() => applyChangeSet(bp, cs(bp, { op: "reorderPages", pageIds: ["pg_clients"] })), "invalid");
    expectError(() => applyChangeSet(bp, cs(bp, { op: "reorderPages", pageIds: ["pg_clients", "pg_clients"] })), "invalid");
  });

  it("edits per-device layouts without touching the default", () => {
    const bp = salonBlueprint();
    const r = applyChangeSet(
      bp,
      cs(
        bp,
        { op: "createLayoutOverride", pageId: "pg_today", layout: "device:phone" },
        { op: "resizeBlock", pageId: "pg_today", blockId: "blk_cal", w: 12, h: 6, layout: "device:phone" },
        { op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x: 0, y: 6, layout: "device:phone" },
      ),
    );
    const page = r.blueprint.pages[0];
    expect(page.layout.blocks[1]).toMatchObject({ w: 8, h: 4 });
    expect(page.layoutOverrides?.["device:phone"]?.blocks[1]).toMatchObject({ w: 12, h: 6 });
    expectError(
      () => applyChangeSet(bp, cs(bp, { op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x: 0, y: 0, layout: "device:tablet" })),
      "not_found",
    );
  });
});

describe("previewChangeSet", () => {
  it("describes ops, flags risk and returns the would-be blueprint without throwing", () => {
    const bp = salonBlueprint();
    const p = previewChangeSet(
      bp,
      cs(
        bp,
        { op: "setPageHidden", pageId: "pg_clients", hidden: true },
        { op: "removeAutomation", automationId: "aut_reminder" },
      ),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.requiresConfirmation).toBe(true);
    expect(p.ops).toEqual([
      { op: "setPageHidden", risk: "safe", description: "Hide page “Clients”" },
      { op: "removeAutomation", risk: "risky", description: "Remove automation “Reminder 24h before”" },
    ]);
    expect(p.blueprint.automations).toHaveLength(0);
  });

  it("returns errors instead of throwing", () => {
    const bp = salonBlueprint();
    const p = previewChangeSet(bp, cs(bp, { op: "removePage", pageId: "pg_nope" }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error.code).toBe("not_found");
  });
});

describe("undo", () => {
  const field: Field = { id: "fld_notes", label: "Notes", type: "long_text" };
  const block: Block = { id: "blk_notes", type: "notes", x: 8, y: 1, w: 4, h: 2 };
  const automation: Automation = {
    id: "aut_thanks",
    label: "Thank-you",
    enabled: true,
    trigger: { type: "status_changed", table: "tbl_bookings", field: "fld_status" },
    conditions: [{ field: "fld_status", op: "eq", value: "opt_done" }],
    actions: [{ type: "notify", message: "Booking done" }],
  };

  it.each<[string, Operation[]]>([
    ["rename", [{ op: "rename", target: { kind: "automation", automationId: "aut_reminder" }, label: "Heads-up" }]],
    ["updateBusiness", [{ op: "updateBusiness", business: { name: "Polished", timezone: "UTC" } }]],
    ["addTable", [{ op: "addTable", table: { id: "tbl_x", label: "X", fields: [] }, index: 0 }]],
    ["removeTable", [
      { op: "removeBlock", pageId: "pg_clients", blockId: "blk_clients" },
      { op: "removeField", tableId: "tbl_bookings", fieldId: "fld_client" },
      { op: "removeTable", tableId: "tbl_clients" },
    ]],
    ["addField", [{ op: "addField", tableId: "tbl_clients", field, index: 1 }]],
    ["removeField", [{ op: "removeField", tableId: "tbl_clients", fieldId: "fld_whatsapp" }]],
    ["updateField", [{ op: "updateField", tableId: "tbl_clients", field: { id: "fld_whatsapp", label: "Mobile", type: "phone", required: true } }]],
    ["addPage", [{ op: "addPage", page: { id: "pg_x", label: "X", menuOrder: 5, hidden: true, layout: { columns: 12, blocks: [] } }, index: 1 }]],
    ["removePage", [{ op: "removePage", pageId: "pg_today" }]],
    ["setPageHidden", [{ op: "setPageHidden", pageId: "pg_today", hidden: true }]],
    ["setPageIcon", [{ op: "setPageIcon", pageId: "pg_today", icon: null }, { op: "setPageIcon", pageId: "pg_clients", icon: "star" }]],
    ["setPageBadge", [{ op: "setPageBadge", pageId: "pg_today", badge: { source: { table: "tbl_clients" }, label: "new", tone: "blue" } }]],
    ["setDocument", [{ op: "setDocument", document: { id: "doc_q", kind: "quote", label: "Quote", table: "tbl_team", customer: "fld_name", lines: { table: "tbl_clients", via: "fld_fav_tech", description: "fld_name", total: "fld_name" }, totals: { total: "fld_name" } } }]],
    ["reorderPages", [{ op: "reorderPages", pageIds: ["pg_clients", "pg_today"] }]],
    ["addBlock", [{ op: "addBlock", pageId: "pg_today", block, index: 1 }]],
    ["removeBlock", [{ op: "removeBlock", pageId: "pg_today", blockId: "blk_rev" }]],
    ["updateBlock", [{ op: "updateBlock", pageId: "pg_today", block: { id: "blk_rev", type: "number", x: 0, y: 0, w: 2, h: 1, options: { color: "green" } } }]],
    ["move + resize", [
      { op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x: 8, y: 0 },
      { op: "resizeBlock", pageId: "pg_today", blockId: "blk_cal", w: 6, h: 3 },
    ]],
    ["layout overrides", [
      { op: "createLayoutOverride", pageId: "pg_today", layout: "device:phone" },
      { op: "removeBlock", pageId: "pg_today", blockId: "blk_rev", layout: "device:phone" },
      { op: "createLayoutOverride", pageId: "pg_today", layout: "user:6f1c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f" },
    ]],
    ["addAutomation", [{ op: "addAutomation", automation }]],
    ["removeAutomation", [{ op: "removeAutomation", automationId: "aut_reminder" }]],
    ["updateAutomation", [{ op: "updateAutomation", automation: { ...automation, id: "aut_reminder" } }]],
    ["toggleAutomation", [{ op: "toggleAutomation", automationId: "aut_reminder", enabled: false }]],
  ])("round-trips %s", (_name, ops) => {
    expectRoundTrip(ops);
  });

  it("can undo an older change when later ones don't conflict", () => {
    const v3 = salonBlueprint();
    const first = applyChangeSet(v3, cs(v3, { op: "rename", target: { kind: "page", pageId: "pg_today" }, label: "Agenda" }));
    const v4 = first.blueprint;
    const second = applyChangeSet(v4, cs(v4, { op: "setPageHidden", pageId: "pg_clients", hidden: true }));
    const undone = undoChangeSet(second.blueprint, first.inverse);
    expect(undone.blueprint.pages[0].label).toBe("Today");
    expect(undone.blueprint.pages[1].hidden).toBe(true);
  });

  it("fails cleanly when a later change removed what undo needs", () => {
    const v3 = salonBlueprint();
    const first = applyChangeSet(v3, cs(v3, { op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x: 8, y: 0 }));
    const second = applyChangeSet(first.blueprint, cs(first.blueprint, { op: "removeBlock", pageId: "pg_today", blockId: "blk_rev" }));
    expectError(() => undoChangeSet(second.blueprint, first.inverse), "not_found");
  });

  it("still asks for confirmation when undo itself is risky", () => {
    const bp = salonBlueprint();
    const added = applyChangeSet(bp, cs(bp, { op: "addField", tableId: "tbl_clients", field }));
    expectError(() => undoChangeSet(added.blueprint, added.inverse), "needs_confirmation");
  });
});
