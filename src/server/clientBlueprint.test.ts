import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { forBrowser } from "./clientBlueprint";
import { brokenByChange } from "@/codegen/references";
import { demoBlueprint } from "@/demo/salon";
import type { Blueprint } from "@/schema/blueprint";

describe("setup sent to the browser", () => {
  it("drops component source but keeps the ids it uses, so Edit mode can still warn", () => {
    const bp: Blueprint = { ...demoBlueprint, components: [{ id: "cmp_x", label: "Hub", source: 'const s = "secret code"; useRecords({ table: "tbl_clients", sort: [{ field: "fld_vip", dir: "asc" }] })', compiled: "x" }] };
    const lite = forBrowser(bp);
    expect(lite.components![0].source).not.toContain("secret code");
    const after = { ...lite, tables: lite.tables.map((t) => (t.id === "tbl_clients" ? { ...t, fields: t.fields.filter((f) => f.id !== "fld_vip") } : t)) };
    expect(brokenByChange(lite, after)).toEqual([{ component: "Hub", ids: ["fld_vip"] }]);
  });
});
