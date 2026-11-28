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

describe("private fields", () => {
  it("are hidden from the assistant's lists and shown with reveal", async () => {
    const { Blueprint } = await import("@/schema/blueprint");
    const { memoryBackend } = await import("@/agent/memoryBackend");
    const { OWNER_TOOLS } = await import("./ownerTools");
    const bp = Blueprint.parse({
      ...demoBlueprint,
      tables: demoBlueprint.tables.map((t) => (t.id === "tbl_clients" ? { ...t, fields: [...t.fields, { id: "fld_alarm", label: "Alarm code", type: "text", sensitive: true }] } : t)),
    });
    const { backend } = memoryBackend({ blueprint: bp, records: [] });
    const c = await backend.createRecord("tbl_clients", { fld_name: "Hannah", fld_alarm: "4321" });
    const q = OWNER_TOOLS.find((t) => t.name === "query_records")!;
    const g = OWNER_TOOLS.find((t) => t.name === "get_record")!;
    const list = JSON.stringify(await q.run(backend as never, { table: "tbl_clients" } as never, {} as never, {} as never));
    expect(list).not.toContain("4321");
    expect(JSON.stringify(await g.run(backend as never, { table: "tbl_clients", id: c.id } as never, {} as never, {} as never))).not.toContain("4321");
    expect(JSON.stringify(await g.run(backend as never, { table: "tbl_clients", id: c.id, reveal: true } as never, {} as never, {} as never))).toContain("4321");
  });
});
