import { describe, expect, it } from "vitest";
import { parseFormRequest } from "./RecordDialog";
import type { SandboxSchema } from "@/sandbox/protocol";

const schema: SandboxSchema = {
  business: { name: "Test", timezone: "UTC", currency: "EUR" },
  tables: [{ id: "tbl_tenants", label: "Tenants", primaryField: "fld_name", fields: [{ id: "fld_name", label: "Name", type: "text" }, { id: "fld_room", label: "Room", type: "link", to: "tbl_rooms" }] }],
};

describe("openRecordForm requests from a frame", () => {
  it("accepts a known table and keeps only known fields", () => {
    expect(parseFormRequest({ table: "tbl_tenants", fields: ["fld_room", "fld_nope", 3], title: "New tenant", defaults: { fld_room: "r1" } }, schema)).toEqual({
      table: "tbl_tenants", recordId: undefined, fields: ["fld_room"], title: "New tenant", submitLabel: undefined, defaults: { fld_room: "r1" },
    });
  });
  it("rejects unknown tables and junk", () => {
    expect(() => parseFormRequest({ table: "tbl_secret" }, schema)).toThrow("Unknown table");
    expect(() => parseFormRequest("tbl_tenants", schema)).toThrow();
    expect(parseFormRequest({ table: "tbl_tenants", fields: [] }, schema).fields).toBeUndefined();
  });
});
