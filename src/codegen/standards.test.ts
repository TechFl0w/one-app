import { describe, expect, it } from "vitest";
import { checkStandards } from "./standards";
import { demoBlueprint } from "@/demo/salon";
import type { Blueprint } from "@/schema/blueprint";

const withPhotos = {
  ...demoBlueprint,
  tables: [
    ...demoBlueprint.tables,
    {
      id: "tbl_photos",
      label: "Photos",
      primaryField: "fld_ph_title",
      fields: [
        { id: "fld_ph_title", label: "Caption", type: "text", required: true },
        { id: "fld_ph_file", label: "Photo", type: "file", required: true },
        { id: "fld_ph_date", label: "Taken on", type: "date" },
      ],
    },
  ],
} as Blueprint;

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

  it("refuses add forms that leave out a required field", () => {
    const bad = 'openRecordForm({ table: "tbl_photos", fields: ["fld_ph_title", "fld_ph_date"], defaults: { fld_x: { a: 1 } } })';
    expect(checkStandards(bad, withPhotos).errors.join("\n")).toMatch(/leaves out Photo \(fld_ph_file\)/);
    expect(checkStandards('openRecordForm({ table: "tbl_photos", fields: ["fld_ph_title", "fld_ph_file"] })', withPhotos).errors).toEqual([]);
    expect(checkStandards('openRecordForm({ table: "tbl_photos", recordId: r.id, fields: ["fld_ph_title"] })', withPhotos).errors).toEqual([]);
  });
  it("asks for photos to be shown and file inputs to upload", () => {
    const list = 'useRecords({ table: "tbl_photos" }); r.data.fld_ph_title';
    expect(checkStandards(list, withPhotos).warnings.join("\n")).toMatch(/never shows it: show it with FileImage/);
    expect(checkStandards(`${list} <FileImage file={r.data.fld_ph_file} />`, withPhotos).warnings.join("\n")).not.toMatch(/FileImage/);
    expect(checkStandards('<input type="file" />', withPhotos).errors[0]).toMatch(/uploads nothing/);
    expect(checkStandards('<img src={r.data.fld_ph_file.path} />', withPhotos).errors[0]).toMatch(/FileImage/);
  });
});
