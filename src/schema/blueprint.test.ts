import { describe, expect, it } from "vitest";
import { Blueprint, emptyBlueprint } from "./blueprint";
import { salonBlueprint } from "@/engine/__tests__/fixtures";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests poke invalid shapes on purpose
type Loose = any;

const errors = (input: unknown) => {
  const r = Blueprint.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("Blueprint schema", () => {
  it("accepts the salon fixture and an empty blueprint", () => {
    expect(errors(salonBlueprint())).toEqual([]);
    expect(emptyBlueprint({ name: "Shop", type: "maker_shop", timezone: "UTC" }).pages).toHaveLength(1);
  });

  it("rejects unknown block, field, trigger and action types", () => {
    const bp = salonBlueprint() as unknown as Loose;
    bp.pages[0].layout.blocks[0].type = "spreadsheet";
    bp.tables[0].fields[0].type = "hologram";
    bp.automations[0].trigger.type = "full_moon";
    bp.automations[0].actions[0].type = "launch_rocket";
    const errs = errors(bp);
    expect(errs.some((e) => e.startsWith("pages.0.layout.blocks.0.type"))).toBe(true);
    expect(errs.some((e) => e.startsWith("tables.0.fields.0"))).toBe(true);
    expect(errs.some((e) => e.startsWith("automations.0.trigger.type"))).toBe(true);
    expect(errs.some((e) => e.startsWith("automations.0.actions.0.type"))).toBe(true);
  });

  it("rejects blocks that do not fit the 12-column grid", () => {
    const bp = salonBlueprint();
    bp.pages[0].layout.blocks[0].x = 10;
    bp.pages[0].layout.blocks[0].w = 4;
    expect(errors(bp)).toContainEqual(expect.stringContaining("12 columns"));
  });

  it("rejects dangling references", () => {
    const bp = salonBlueprint();
    bp.pages[1].layout.blocks[0].source = { table: "tbl_nope" };
    expect(errors(bp)).toContainEqual(expect.stringContaining("unknown table tbl_nope"));

    const bp2 = salonBlueprint();
    bp2.pages[0].layout.blocks[1].source!.groupBy = "fld_missing";
    expect(errors(bp2)).toContainEqual(expect.stringContaining("unknown field fld_missing"));

    const bp3 = salonBlueprint();
    bp3.automations[0].trigger.table = "tbl_gone";
    expect(errors(bp3)).toContainEqual(expect.stringContaining("unknown table tbl_gone"));
  });

  it("rejects duplicate ids", () => {
    const bp = salonBlueprint();
    bp.pages[1].layout.blocks[0].id = "blk_rev";
    expect(errors(bp)).toContainEqual(expect.stringContaining("duplicate id blk_rev"));
  });

  it("allows the same field id on different tables", () => {
    // fld_name is used on both tbl_team and tbl_clients in the fixture.
    expect(errors(salonBlueprint())).toEqual([]);
  });

  it("validates ids and layout keys", () => {
    const bp = salonBlueprint() as unknown as Loose;
    bp.tables[0].id = "Team";
    bp.pages[0].layoutOverrides = { "device:fridge": { blocks: [] } };
    const errs = errors(bp);
    expect(errs.some((e) => e.startsWith("tables.0.id"))).toBe(true);
    expect(errs.some((e) => e.startsWith("pages.0.layoutOverrides"))).toBe(true);
  });
});
