import { describe, expect, it } from "vitest";
import { deviceFromUserAgent, gridRows, layoutBlocks, layoutTargets, menuPages, readingOrder, resolveLayout, stackForPhone } from "./layout";
import { salonBlueprint } from "./__tests__/fixtures";
import type { Block, Page } from "@/schema/blueprint";

const blk = (id: string, x: number, y: number, w = 4, h = 1): Block => ({ id, type: "notes", x, y, w, h });
const USER = "6f1c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f";

describe("menuPages", () => {
  it("sorts by menuOrder and drops hidden pages", () => {
    const bp = salonBlueprint();
    bp.pages[0].menuOrder = 5;
    expect(menuPages(bp).map((p) => p.id)).toEqual(["pg_clients", "pg_today"]);
    bp.pages[1].hidden = true;
    expect(menuPages(bp).map((p) => p.id)).toEqual(["pg_today"]);
  });
});

describe("resolveLayout", () => {
  const page: Page = {
    id: "pg_x",
    label: "X",
    menuOrder: 0,
    hidden: false,
    layout: { columns: 12, blocks: [blk("blk_a", 0, 0)] },
    layoutOverrides: {
      "device:phone": { blocks: [blk("blk_a", 0, 0, 12)] },
      [`user:${USER}`]: { blocks: [blk("blk_a", 8, 0)] },
    },
  };

  it("prefers user, then device, then default", () => {
    expect(resolveLayout(page, { device: "desktop", userId: USER }).source).toBe(`user:${USER}`);
    expect(resolveLayout(page, { device: "phone" })).toMatchObject({ source: "device:phone", stack: false });
    expect(resolveLayout(page, { device: "desktop" }).source).toBe("default");
    expect(resolveLayout(page, { device: "tablet", userId: "someone-else" }).source).toBe("default");
  });

  it("stacks the default layout on phones without a phone layout", () => {
    const plain = { ...page, layoutOverrides: undefined };
    expect(resolveLayout(plain, { device: "phone" })).toMatchObject({ source: "default", stack: true });
  });
});

describe("grid helpers", () => {
  it("orders blocks top-to-bottom, left-to-right and counts rows", () => {
    const blocks = [blk("blk_c", 0, 2, 4, 3), blk("blk_b", 6, 0), blk("blk_a", 0, 0)];
    expect(readingOrder(blocks).map((b) => b.id)).toEqual(["blk_a", "blk_b", "blk_c"]);
    expect(gridRows(blocks)).toBe(5);
    expect(gridRows([])).toBe(0);
  });

  it("maps user agents to devices", () => {
    expect(deviceFromUserAgent({ device: { type: "mobile" } })).toBe("phone");
    expect(deviceFromUserAgent({ device: { type: "tablet" } })).toBe("tablet");
    expect(deviceFromUserAgent({ device: {} })).toBe("desktop");
  });
});

describe("layout targets", () => {
  const page: Page = {
    id: "pg_x",
    label: "X",
    menuOrder: 0,
    hidden: false,
    layout: { columns: 12, blocks: [blk("blk_a", 0, 0)] },
    layoutOverrides: { "device:phone": { blocks: [blk("blk_a", 0, 0, 12)] } },
  };

  it("lists targets with existence, 'Just me' only for signed-in users", () => {
    expect(layoutTargets(page).map((t) => [t.key, t.exists])).toEqual([
      ["default", true],
      ["device:phone", true],
      ["device:tablet", false],
    ]);
    expect(layoutTargets(page, USER).at(-1)).toEqual({ key: `user:${USER}`, label: "Just me", exists: false });
  });

  it("returns the blocks of one layout", () => {
    expect(layoutBlocks(page, "device:phone")?.[0].w).toBe(12);
    expect(layoutBlocks(page, "device:tablet")).toBeNull();
    expect(layoutBlocks(page, "default")).toBe(page.layout.blocks);
  });
});

describe("stackForPhone", () => {
  it("stacks blocks full width in reading order", () => {
    const out = stackForPhone([blk("blk_b", 6, 0, 6, 2), blk("blk_a", 0, 0, 6, 1), blk("blk_c", 0, 2, 12, 3)]);
    expect(out.map((b) => [b.id, b.x, b.y, b.w, b.h])).toEqual([
      ["blk_a", 0, 0, 12, 1],
      ["blk_b", 0, 1, 12, 2],
      ["blk_c", 0, 3, 12, 3],
    ]);
  });
});
