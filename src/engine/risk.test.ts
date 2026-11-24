import { describe, expect, it } from "vitest";
import { recordUpdateIsRisky } from "./risk";
import { demoBlueprint } from "@/demo/salon";

describe("risk policy", () => {
  const bookings = demoBlueprint.tables.find((t) => t.id === "tbl_bookings")!;
  it("treats money changes as risky, other edits as safe", () => {
    expect(recordUpdateIsRisky(bookings, { fld_amount: 60 })).toBe(true);
    expect(recordUpdateIsRisky(bookings, { fld_notes: "x", fld_amount: null })).toBe(true);
    expect(recordUpdateIsRisky(bookings, { fld_notes: "x" })).toBe(false);
  });
});
