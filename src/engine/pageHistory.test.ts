import { describe, expect, it } from "vitest";
import { applyChangeSet } from "./changeSet";
import { restorePageOps, touchesPage } from "./pageHistory";
import { salonBlueprint } from "./__tests__/fixtures";
import type { Blueprint } from "@/schema/blueprint";
import type { Operation } from "@/schema/changeSet";

const apply = (bp: Blueprint, ...ops: Operation[]) => applyChangeSet(bp, { baseVersion: bp.version, source: "ui", ops }, { confirmed: true }).blueprint;

describe("page version history", () => {
  it("puts a page back exactly: name, blocks, phone layout and the screen it shows", () => {
    const comp = (v: number) => ({ id: "cmp_hub", label: "Hub", source: `export default function X() { return <div>${v}</div> }`, compiled: `exports.default=()=>${v}` });
    const v1 = apply(salonBlueprint(), { op: "putComponent", component: comp(1) }, { op: "addBlock", pageId: "pg_today", block: { id: "blk_hub", type: "custom", x: 0, y: 20, w: 12, h: 4, options: { component: "cmp_hub" } } });
    const page1 = v1.pages.find((p) => p.id === "pg_today")!;
    const first = page1.layout.blocks[0];
    const v2 = apply(
      v1,
      { op: "rename", target: { kind: "page", pageId: "pg_today" }, label: "Agenda" },
      { op: "removeBlock", pageId: "pg_today", blockId: first.id },
      { op: "putComponent", component: comp(2) },
      { op: "createLayoutOverride", pageId: "pg_today", layout: "device:phone" },
    );
    const back = apply(v2, ...restorePageOps(v2, v1, "pg_today"));
    const page = back.pages.find((p) => p.id === "pg_today")!;
    expect(page.label).toBe(page1.label);
    expect(new Set(page.layout.blocks.map((b) => JSON.stringify(b)))).toEqual(new Set(page1.layout.blocks.map((b) => JSON.stringify(b))));
    expect(page.layoutOverrides?.["device:phone"]).toBeUndefined();
    expect(back.components?.[0].source).toContain("1");
    expect(restorePageOps(back, v1, "pg_today")).toEqual([]);
  });

  it("knows which changes touched a page", () => {
    const screens = new Set(["cmp_hub"]);
    expect(touchesPage([{ op: "moveBlock", pageId: "pg_today" }], "pg_today", screens)).toBe(true);
    expect(touchesPage([{ op: "putComponent", component: { id: "cmp_hub" } }], "pg_today", screens)).toBe(true);
    expect(touchesPage([{ op: "rename", target: { kind: "page", pageId: "pg_clients" } }], "pg_today", screens)).toBe(false);
  });
});
