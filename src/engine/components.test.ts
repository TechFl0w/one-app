import { describe, expect, it } from "vitest";
import { applyChangeSet, ChangeSetError, undoChangeSet } from "./changeSet";
import { salonBlueprint } from "./__tests__/fixtures";
import type { Blueprint, Component } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";

const cs = (bp: Blueprint, ...ops: Operation[]) => ({ baseVersion: bp.version, source: "ai" as const, ops });
const comp = (v = 1): Component => ({ id: "cmp_hub", label: "Booking hub", source: `export default function X() { return <div>${v}</div> }`, compiled: `"use strict";exports.default=()=>${v};` });
const customBlock = { id: "blk_hub", type: "custom" as const, x: 0, y: 0, w: 12, h: 6, options: { component: "cmp_hub" } };

describe("generated components", () => {
  it("adds, updates and undoes components exactly", () => {
    const bp = salonBlueprint();
    const added = applyChangeSet(bp, cs(bp, { op: "putComponent", component: comp(1) }, { op: "addBlock", pageId: "pg_today", block: customBlock }));
    expect(added.blueprint.components).toEqual([comp(1)]);
    const updated = applyChangeSet(added.blueprint, cs(added.blueprint, { op: "putComponent", component: comp(2) }));
    expect(updated.blueprint.components?.[0].source).toContain("2");
    const back = undoChangeSet(updated.blueprint, updated.inverse);
    expect(back.blueprint.components).toEqual([comp(1)]);
    const gone = undoChangeSet(back.blueprint, added.inverse);
    expect(gone.blueprint.components).toBeUndefined();
    expect({ ...gone.blueprint, version: bp.version }).toEqual(bp);
  });

  it("rejects custom blocks pointing at unknown components", () => {
    const bp = salonBlueprint();
    const r = (() => { try { applyChangeSet(bp, cs(bp, { op: "addBlock", pageId: "pg_today", block: customBlock })); } catch (e) { return e; } })();
    expect(r).toBeInstanceOf(ChangeSetError);
    expect((r as ChangeSetError).message).toMatch(/component/);
  });

  it("won't remove a component that's still on a page", () => {
    const bp = salonBlueprint();
    const added = applyChangeSet(bp, cs(bp, { op: "putComponent", component: comp() }, { op: "addBlock", pageId: "pg_today", block: customBlock }));
    expect(() => applyChangeSet(added.blueprint, cs(added.blueprint, { op: "removeComponent", componentId: "cmp_hub" }))).toThrow(/still shown/);
    const ok = applyChangeSet(added.blueprint, cs(added.blueprint, { op: "removeBlock", pageId: "pg_today", blockId: "blk_hub" }, { op: "removeComponent", componentId: "cmp_hub" }));
    expect(ok.blueprint.components).toBeUndefined();
  });
});

describe("AI layout changes don't overlap", () => {
  it("pushes covered blocks down", async () => {
    const { overlapFixOps } = await import("./editing");
    const bp = salonBlueprint();
    const page = bp.pages.find((p) => p.layout.blocks.length >= 2)!;
    const add = { op: "addBlock" as const, pageId: page.id, block: { id: "blk_banner", type: "notes" as const, x: 0, y: 0, w: 12, h: 2, options: { text: "Hi" } } };
    const after = applyChangeSet(bp, cs(bp, add)).blueprint;
    const fixes = overlapFixOps(after, [add]);
    const final = applyChangeSet(after, cs(after, ...fixes)).blueprint.pages.find((p) => p.id === page.id)!.layout.blocks;
    const overlap = (a: (typeof final)[number], b: (typeof final)[number]) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const a of final) for (const b of final) if (a !== b) expect(overlap(a, b), `${a.id} vs ${b.id}`).toBe(false);
    expect(final.find((b) => b.id === "blk_banner")!.y).toBe(0);
  });
});
