import { describe, expect, it } from "vitest";
import { checkStandards } from "./standards";
import { demoBlueprint } from "@/demo/salon";

describe("app rules checked in code", () => {
  it("refuses add forms on the page unless asked for", () => {
    const src = '<RecordForm table="tbl_bookings" />';
    expect(checkStandards(src, demoBlueprint).errors[0]).toMatch(/pop-up/);
    expect(checkStandards(src, demoBlueprint, { inlineForm: true }).errors).toEqual([]);
    expect(checkStandards('openRecordForm({ table: "tbl_bookings" })', demoBlueprint).errors).toEqual([]);
  });
  it("asks for the parent to be shown, and for option ids instead of labels", () => {
    const { warnings } = checkStandards('const { records } = useRecords({ table: "tbl_bookings" }); r.data.fld_status === "Booked"', demoBlueprint);
    expect(warnings.join("\n")).toMatch(/Bookings belong to Clients \(fld_client\)/);
    expect(warnings.join("\n")).toMatch(/option id "opt_booked"/);
  });
});
