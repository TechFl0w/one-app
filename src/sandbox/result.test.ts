import { describe, expect, it } from "vitest";
import { RecordQuery } from "@/schema/records";
import { bridged, unwrap } from "./result";

describe("bridge results", () => {
  it("turns failures into typed data instead of opaque errors", async () => {
    const tooMany = await bridged(async () => RecordQuery.parse({ table: "tbl_x", limit: 1000 }));
    expect(tooMany).toMatchObject({ ok: false, code: "invalid_query" });
    expect(!tooMany.ok && tooMany.error).toMatch(/^limit:/);
    const typed = await bridged(async () => {
      throw Object.assign(new Error("Table tbl_x not found"), { code: "not_found" });
    });
    expect(typed).toEqual({ ok: false, code: "not_found", error: "Table tbl_x not found" });
    expect(() => unwrap(typed)).toThrow("not_found: Table tbl_x not found");
    expect(unwrap(await bridged(async () => 42))).toBe(42);
  });
});
