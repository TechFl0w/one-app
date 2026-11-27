import { describe, expect, it } from "vitest";
import { demoBlueprint } from "@/demo/salon";
import { staleReason } from "./stale";

describe("staleReason", () => {
  it("keeps requests that still apply", () => {
    expect(staleReason(demoBlueprint, "change_setup", { ops: [{ op: "rename", target: { kind: "table", tableId: demoBlueprint.tables[0].id }, label: "People" }] })).toBeNull();
    expect(staleReason(demoBlueprint, "delete_record", { table: demoBlueprint.tables[0].id, id: "x" })).toBeNull();
  });
  it("flags requests for tables that are gone", () => {
    expect(staleReason(demoBlueprint, "change_setup", { ops: [{ op: "removeTable", tableId: "tbl_gone" }] })).toBeTruthy();
    expect(staleReason(demoBlueprint, "delete_record", { table: "tbl_gone", id: "x" })).toMatch(/removed/);
  });
});
