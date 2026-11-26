import { describe, expect, it } from "vitest";
import { assertFilesInBusiness, buildRecordQuery, linkedIds, projectData, RecordError, validateRecordInput } from "./records";
import { salonBlueprint } from "./__tests__/fixtures";
import type { Table } from "@/schema/blueprint";

const ID = "6f1c2b9e-1d2a-4c3b-9f8e-7a6b5c4d3e2f";
const ID2 = "0b9d3e8a-2c4f-4a1b-8e7d-6c5b4a3f2e1d";

const table: Table = {
  id: "tbl_jobs",
  label: "Jobs",
  fields: [
    { id: "fld_title", label: "Title", type: "text", required: true },
    { id: "fld_notes", label: "Notes", type: "long_text" },
    { id: "fld_qty", label: "Qty", type: "number" },
    { id: "fld_price", label: "Price", type: "money" },
    { id: "fld_paid", label: "Paid", type: "checkbox" },
    { id: "fld_due", label: "Due", type: "date" },
    { id: "fld_at", label: "At", type: "datetime" },
    { id: "fld_status", label: "Status", type: "status", options: [{ id: "opt_new", label: "New" }, { id: "opt_done", label: "Done" }] },
    { id: "fld_tags", label: "Tags", type: "choice", multiple: true, options: [{ id: "opt_rush", label: "Rush" }, { id: "opt_gift", label: "Gift" }] },
    { id: "fld_client", label: "Client", type: "link", to: "tbl_clients" },
    { id: "fld_helpers", label: "Helpers", type: "link", to: "tbl_team", multiple: true },
    { id: "fld_phone", label: "Phone", type: "phone" },
    { id: "fld_email", label: "Email", type: "email" },
    { id: "fld_photo", label: "Photo", type: "file" },
    { id: "fld_gallery", label: "Gallery", type: "file", multiple: true },
    { id: "fld_total", label: "Total", type: "formula", expression: "fld_qty * fld_price" },
  ],
};

function fieldErrors(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RecordError);
    return (e as RecordError).fieldErrors.map((f) => f.field);
  }
  throw new Error("expected RecordError");
}

describe("validateRecordInput", () => {
  it("accepts and normalises valid values", () => {
    const out = validateRecordInput(
      table,
      {
        fld_title: "Fix bike",
        fld_qty: 2,
        fld_price: 19.99,
        fld_paid: false,
        fld_due: "2026-12-01",
        fld_at: "2026-12-01T09:30:00-08:00",
        fld_status: "opt_new",
        fld_tags: ["opt_rush", "opt_rush", "opt_gift"],
        fld_client: ID,
        fld_helpers: [ID, ID2],
        fld_phone: " +1 (604) 555-0100 ",
        fld_email: "Ann@Example.com",
        fld_photo: { path: "biz/photo.jpg", name: "photo.jpg", size: 1200 },
      },
      "create",
    );
    expect(out).toMatchObject({
      fld_at: "2026-12-01T17:30:00.000Z",
      fld_tags: ["opt_rush", "opt_gift"],
      fld_phone: "+1 (604) 555-0100",
      fld_email: "ann@example.com",
    });
  });

  it("enforces required fields on create but not on update", () => {
    expect(fieldErrors(() => validateRecordInput(table, { fld_qty: 1 }, "create"))).toEqual(["fld_title"]);
    expect(validateRecordInput(table, { fld_qty: 1 }, "update")).toEqual({ fld_qty: 1 });
    expect(fieldErrors(() => validateRecordInput(table, { fld_title: null }, "update"))).toEqual(["fld_title"]);
  });

  it("treats null and empty string as clearing a field", () => {
    expect(validateRecordInput(table, { fld_qty: null, fld_notes: "" }, "update")).toEqual({ fld_qty: null, fld_notes: null });
  });

  it("rejects wrong types, unknown options, unknown fields and calculated fields", () => {
    const errs = fieldErrors(() =>
      validateRecordInput(
        table,
        {
          fld_title: 42,
          fld_qty: "2",
          fld_price: 1.234,
          fld_paid: "yes",
          fld_due: "2026-02-30",
          fld_at: "2026-12-01T09:30:00",
          fld_status: "opt_lost",
          fld_tags: "opt_rush",
          fld_client: "not-a-uuid",
          fld_email: "nope",
          fld_photo: "photo.jpg",
          fld_total: 10,
          fld_ghost: "boo",
        },
        "update",
      ),
    );
    expect(errs.sort()).toEqual(
      ["fld_title", "fld_qty", "fld_price", "fld_paid", "fld_due", "fld_at", "fld_status", "fld_tags", "fld_client", "fld_email", "fld_photo", "fld_total", "fld_ghost"].sort(),
    );
  });

  it("rejects non-object input", () => {
    expect(() => validateRecordInput(table, ["x"], "create")).toThrow(RecordError);
    expect(() => validateRecordInput(table, { Title: "x" }, "create")).toThrow(RecordError);
  });
});

describe("linkedIds / projectData", () => {
  it("groups linked ids by target table", () => {
    const m = linkedIds(table, { fld_client: ID, fld_helpers: [ID, ID2] });
    expect([...m.get("tbl_clients")!]).toEqual([ID]);
    expect([...m.get("tbl_team")!]).toEqual([ID, ID2]);
  });

  it("hides data for fields no longer in the blueprint", () => {
    expect(projectData(table, { fld_title: "x", fld_removed: 1 })).toEqual({ fld_title: "x" });
  });
});

describe("buildRecordQuery", () => {
  const bp = salonBlueprint();

  it("builds typed filters and sorts", () => {
    const p = buildRecordQuery(bp, {
      table: "tbl_bookings",
      filters: [
        { field: "fld_amount", op: "gte", value: 50 },
        { field: "fld_status", op: "eq", value: "opt_booked" },
        { field: "fld_start", op: "lt", value: "2026-12-01T00:00:00Z" },
        { field: "fld_practitioner", op: "empty" },
      ],
      sort: [{ field: "fld_start", dir: "desc" }, { field: "_created_at", dir: "asc" }],
    });
    expect(p).toEqual({
      p_table_id: "tbl_bookings",
      p_filters: [
        { field: "fld_amount", op: "gte", kind: "number", value: "50" },
        { field: "fld_status", op: "eq", kind: "text", value: "opt_booked" },
        { field: "fld_start", op: "lt", kind: "datetime", value: "2026-12-01T00:00:00.000Z" },
        { field: "fld_practitioner", op: "empty", kind: "text" },
      ],
      p_sort: [{ field: "fld_start", dir: "desc", kind: "datetime" }, { field: "_created_at", dir: "asc" }],
      p_limit: 50,
      p_offset: 0,
    });
  });

  it("rejects unknown tables, fields, bad ops and bad values", () => {
    expect(() => buildRecordQuery(bp, { table: "tbl_nope" })).toThrow(/not found/);
    const errs = fieldErrors(() =>
      buildRecordQuery(bp, {
        table: "tbl_bookings",
        filters: [
          { field: "fld_ghost", op: "eq", value: "x" },
          { field: "fld_status", op: "gt", value: "opt_booked" },
          { field: "fld_amount", op: "eq", value: "fifty" },
          { field: "fld_status", op: "eq", value: "opt_unknown" },
          { field: "fld_amount", op: "eq" },
        ],
      }),
    );
    expect(errs).toEqual(["fld_ghost", "fld_status", "fld_amount", "fld_status", "fld_amount"]);
  });

  it("caps limit", () => {
    expect(() => buildRecordQuery(bp, { table: "tbl_bookings", limit: 10_000 })).toThrow(RecordError);
  });
});

describe("amount and number checks on the server", () => {
  const t = (fields: Table["fields"]) => ({ id: "tbl_x", label: "X", fields }) as Table;
  const money = t([{ id: "fld_amt", label: "Amount", type: "money" }]);
  const refund = t([{ id: "fld_amt", label: "Refund", type: "money", allowNegative: true }]);
  const nights = t([{ id: "fld_n", label: "Nights", type: "number", min: 1, max: 30 }]);
  const fails = (tbl: Table, data: Record<string, unknown>) => {
    try {
      validateRecordInput(tbl, data, "create");
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  it("refuses negative amounts unless the field allows them", () => {
    expect(fails(money, { fld_amt: -50 })).toMatch(/Amount can't be negative/);
    expect(fails(refund, { fld_amt: -50 })).toBeNull();
    expect(fails(money, { fld_amt: 50 })).toBeNull();
  });
  it("refuses absurd amounts and numbers outside their range", () => {
    expect(fails(money, { fld_amt: 900_000_000 })).toMatch(/too large/);
    expect(fails(nights, { fld_n: 0 })).toMatch(/at least 1/);
    expect(fails(nights, { fld_n: 31 })).toMatch(/at most 30/);
    expect(fails(nights, { fld_n: 3 })).toBeNull();
  });
});

describe("photo galleries", () => {
  const photo = (n: number, extra = {}) => ({ path: `${ID}/tbl_jobs/${ID2}/p${n}.webp`, name: `p${n}.webp`, mime: "image/webp", width: 2400, height: 1600, ...extra });
  it("a gallery field holds a list; a single file becomes a list of one", () => {
    expect(validateRecordInput(table, { fld_title: "x", fld_gallery: [photo(1), photo(2)] }, "create").fld_gallery).toHaveLength(2);
    expect(validateRecordInput(table, { fld_title: "x", fld_gallery: photo(1) }, "create").fld_gallery).toEqual([photo(1)]);
  });
  it("videos keep their still frame", () => {
    const video = { path: `${ID}/tbl_jobs/${ID2}/clip.mov`, name: "clip.mov", mime: "video/quicktime", poster: `${ID}/tbl_jobs/${ID2}/clip.jpg` };
    expect(validateRecordInput(table, { fld_title: "x", fld_photo: video }, "create").fld_photo).toEqual(video);
  });
  it("rejects files that aren't file values", () => {
    expect(fieldErrors(() => validateRecordInput(table, { fld_title: "x", fld_gallery: ["a.jpg"] }, "create"))).toEqual(["fld_gallery"]);
  });
  it("only accepts files (and stills) from the business's own folder", () => {
    expect(() => assertFilesInBusiness(table, { fld_gallery: [photo(1)] }, ID)).not.toThrow();
    expect(() => assertFilesInBusiness(table, { fld_gallery: [photo(1), { ...photo(2), path: `${ID2}/tbl_jobs/x/p.webp` }] }, ID)).toThrow();
    expect(() => assertFilesInBusiness(table, { fld_photo: photo(1, { poster: `${ID2}/tbl_jobs/x/s.jpg` }) }, ID)).toThrow();
  });
});
