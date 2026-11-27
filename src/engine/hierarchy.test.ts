import { describe, expect, it } from "vitest";
import { belongsTo, impliedParent, narrowings, parentFieldOf } from "./hierarchy";

const tables = [
  { id: "tbl_owners", primaryField: "fld_name", fields: [{ id: "fld_name", type: "text" }] },
  { id: "tbl_pets", primaryField: "fld_pet", fields: [{ id: "fld_pet", type: "text" }, { id: "fld_pet_owner", type: "link", to: "tbl_owners" }] },
  { id: "tbl_staff", primaryField: "fld_sname", fields: [{ id: "fld_sname", type: "text" }] },
  {
    id: "tbl_appts",
    primaryField: "fld_when",
    fields: [
      { id: "fld_when", type: "datetime" },
      { id: "fld_owner", type: "link", to: "tbl_owners" },
      { id: "fld_pet", type: "link", to: "tbl_pets" },
      { id: "fld_staff", type: "link", to: "tbl_staff", multiple: true },
    ],
  },
];

describe("hierarchy", () => {
  it("narrows the pet picker by the owner, worked out from the setup", () => {
    expect(narrowings(tables, "tbl_appts")).toEqual({ fld_pet: { parent: "fld_owner", via: "fld_pet_owner" } });
  });
  it("only when both fields are on the form", () => {
    expect(narrowings(tables, "tbl_appts", ["fld_pet", "fld_when"])).toEqual({});
  });
  it("can be turned off or overridden", () => {
    const off = tables.map((t) => (t.id === "tbl_appts" ? { ...t, fields: t.fields.map((f) => (f.id === "fld_pet" ? { ...f, narrowBy: false as const } : f)) } : t));
    expect(narrowings(off, "tbl_appts")).toEqual({});
  });
  it("knows a pet belongs to its owner", () => {
    expect(parentFieldOf(tables, "tbl_pets")?.id).toBe("fld_pet_owner");
    expect(parentFieldOf(tables, "tbl_owners")).toBeUndefined();
    const biscuit = { data: { fld_pet: "Biscuit", fld_pet_owner: "own_lisa" } };
    expect(belongsTo(biscuit, "fld_pet_owner", "own_lisa")).toBe(true);
    expect(belongsTo(biscuit, "fld_pet_owner", "own_tom")).toBe(false);
    expect(belongsTo(biscuit, "fld_pet_owner", "")).toBe(true);
    expect(impliedParent(biscuit, "fld_pet_owner")).toBe("own_lisa");
  });
});
