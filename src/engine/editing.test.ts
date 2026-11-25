import { describe, expect, it } from "vitest";
import { compactOps, layoutOps, movePageOp, newBlockOp, newFieldOp, newId, newPageOp, pushDown, takenIds } from "./editing";
import { applyChangeSet } from "./changeSet";
import { demoBlueprint } from "@/demo/salon";
import type { Block, Blueprint } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";

const bp = demoBlueprint;
const apply = (b: Blueprint, ...ops: Operation[]) => applyChangeSet(b, { baseVersion: b.version, source: "ui", ops }, { confirmed: true }).blueprint;
const blk = (id: string, x: number, y: number, w: number, h: number): Block => ({ id, type: "notes", x, y, w, h });

describe("newId", () => {
  it("slugifies labels and avoids collisions", () => {
    const taken = new Set(["fld_favourite_tech"]);
    expect(newId("fld", "Favourite tech", taken)).toBe("fld_favourite_tech_2");
    expect(newId("fld", "Favourite tech", taken)).toBe("fld_favourite_tech_3");
    expect(newId("pg", "Café & Crème!", new Set())).toBe("pg_cafe_creme");
    expect(newId("pg", "✨", new Set())).toBe("pg_item");
  });

  it("knows every id in the blueprint", () => {
    const ids = takenIds(bp, "tbl_bookings");
    expect(ids.has("blk_cal")).toBe(true);
    expect(ids.has("fld_start")).toBe(true);
    expect(ids.has("pg_settings")).toBe(true);
  });
});

describe("grid editing", () => {
  it("pushes overlapped blocks down, transitively", () => {
    const blocks = [blk("blk_a", 0, 0, 6, 2), blk("blk_b", 0, 2, 6, 2), blk("blk_c", 0, 4, 6, 1), blk("blk_d", 6, 0, 6, 2)];
    const moved = pushDown(blocks.map((b) => (b.id === "blk_a" ? { ...b, h: 3 } : b)), "blk_a");
    expect(moved.map((b) => [b.id, b.y])).toEqual([["blk_a", 0], ["blk_b", 3], ["blk_c", 5], ["blk_d", 0]]);
  });

  it("clamps to the grid and produces valid ops", () => {
    const page = bp.pages[0];
    const ops = layoutOps(page.id, page.layout.blocks, "blk_rev", { x: 11, y: -3 });
    expect(ops[0]).toEqual({ op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x: 8, y: 0, layout: undefined });
    expect(ops.length).toBeGreaterThan(1);
    // blk_req sits at x 8 → it gets pushed down, and so does whatever it then overlaps
    const after = apply(bp, ...ops).pages[0].layout.blocks;
    const pos = Object.fromEntries(after.map((b) => [b.id, [b.x, b.y]]));
    expect(pos.blk_rev).toEqual([8, 0]);
    expect(pos.blk_req[1]).toBeGreaterThanOrEqual(1);
    for (const a of after) for (const b of after) {
      if (a.id === b.id) continue;
      const hit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(hit, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  });

  it("resizes within the grid", () => {
    const page = bp.pages[0];
    const ops = layoutOps(page.id, page.layout.blocks, "blk_next", { w: 9, h: 0 });
    expect(ops[0]).toEqual({ op: "resizeBlock", pageId: "pg_today", blockId: "blk_next", w: 4, h: 1, layout: undefined });
  });

  it("compacts repeated drags of the same block", () => {
    const m = (x: number): Operation => ({ op: "moveBlock", pageId: "pg_today", blockId: "blk_rev", x, y: 0 });
    const r: Operation = { op: "rename", target: { kind: "page", pageId: "pg_today" }, label: "Now" };
    expect(compactOps([m(1), r, m(2), m(3)])).toEqual([r, m(3)]);
  });
});

describe("menu", () => {
  it("swaps a page with its neighbour, hidden pages included", () => {
    expect(movePageOp(bp, "pg_bookings", -1)).toEqual({ op: "reorderPages", pageIds: ["pg_bookings", "pg_today", "pg_clients", "pg_services", "pg_settings"] });
    expect(movePageOp(bp, "pg_today", -1)).toBeNull();
  });
});

describe("new pages, blocks and fields", () => {
  it("adds pages from templates that validate", () => {
    for (const t of ["blank", "table", "board", "calendar", "dashboard"] as const) {
      const op = newPageOp(bp, "Appointments", t, "tbl_bookings");
      expect(typeof op).not.toBe("string");
      const next = apply(bp, op as Operation);
      expect(next.pages.at(-1)).toMatchObject({ id: "pg_appointments", menuOrder: 10 });
    }
    expect(newPageOp(bp, "x", "board", "tbl_clients")).toMatch(/no status/);
    expect(newPageOp(bp, "x", "table")).toMatch(/Pick a table/);
  });

  it("adds blocks below the existing ones", () => {
    const page = bp.pages[0];
    const op = newBlockOp(bp, page, page.layout.blocks, "table", "tbl_clients") as Extract<Operation, { op: "addBlock" }>;
    expect(op.block).toMatchObject({ type: "table", x: 0, y: 6, w: 12 });
    expect(apply(bp, op).pages[0].layout.blocks).toHaveLength(6);
    expect(newBlockOp(bp, page, [], "calendar", "tbl_clients")).toMatch(/no date/);
    expect(typeof newBlockOp(bp, page, [], "notes", undefined)).toBe("object");
  });

  it("adds fields of every simple type, choices and links", () => {
    const clients = bp.tables.find((t) => t.id === "tbl_clients")!;
    const status = newFieldOp(bp, clients, { label: "Stage", type: "status", options: ["New", "Regular", "New", " "] });
    expect(status).toMatchObject({ field: { id: "fld_stage", options: [{ id: "opt_new", label: "New" }, { id: "opt_regular", label: "Regular" }] } });
    const name = newFieldOp(bp, clients, { label: "Name", type: "text" });
    expect(name).toMatchObject({ field: { id: "fld_name_2" } });
    const link = newFieldOp(bp, clients, { label: "Usual service", type: "link", linkTo: "tbl_services" });
    expect(apply(bp, status as Operation, name as Operation, link as Operation).tables[1].fields).toHaveLength(8);
    expect(newFieldOp(bp, clients, { label: "x", type: "choice" })).toMatch(/option/);
    expect(newFieldOp(bp, clients, { label: " ", type: "text" })).toMatch(/name/);
  });
});
