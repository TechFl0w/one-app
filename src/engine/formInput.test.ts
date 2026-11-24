import { describe, expect, it } from "vitest";
import { formToInput, localDateTimeToIso } from "./formInput";
import { validateRecordInput } from "./records";
import { demoBlueprint } from "@/demo/salon";

const fd = (entries: [string, string][]) => {
  const f = new FormData();
  entries.forEach(([k, v]) => f.append(k, v));
  return f;
};

describe("formToInput", () => {
  const bookings = demoBlueprint.tables.find((t) => t.id === "tbl_bookings")!;
  const clients = demoBlueprint.tables.find((t) => t.id === "tbl_clients")!;

  it("converts form strings into typed values that validate", () => {
    const input = formToInput(
      bookings.fields,
      fd([
        ["fld_client", "00000000-0000-4000-8000-000000000010"],
        ["fld_start", "2026-07-01T09:30"],
        ["fld_status", "opt_booked"],
        ["fld_amount", "55"],
        ["fld_notes", ""],
      ]),
      "America/Los_Angeles",
    );
    expect(input).toMatchObject({ fld_start: "2026-07-01T16:30:00.000Z", fld_amount: 55, fld_notes: null, fld_service: null });
    expect(validateRecordInput(bookings, input, "create")).toMatchObject({ fld_amount: 55 });
  });

  it("handles checkboxes (unchecked = false)", () => {
    expect(formToInput(clients.fields, fd([["fld_name", "A"]]), "UTC")).toMatchObject({ fld_vip: false });
    expect(formToInput(clients.fields, fd([["fld_name", "A"], ["fld_vip", "on"]]), "UTC")).toMatchObject({ fld_vip: true });
  });
});

describe("localDateTimeToIso", () => {
  it("interprets wall-clock time in the business timezone", () => {
    expect(localDateTimeToIso("2026-07-01T09:30", "America/Los_Angeles")).toBe("2026-07-01T16:30:00.000Z");
    expect(localDateTimeToIso("2026-01-15T09:30", "America/Los_Angeles")).toBe("2026-01-15T17:30:00.000Z");
    // DST starts at 02:00 on 2026-03-08; 10:00 that day is already PDT
    expect(localDateTimeToIso("2026-03-08T10:00", "America/Los_Angeles")).toBe("2026-03-08T17:00:00.000Z");
    expect(localDateTimeToIso("2026-06-01T00:15", "Asia/Kolkata")).toBe("2026-05-31T18:45:00.000Z");
    expect(localDateTimeToIso("nope", "UTC")).toBeNull();
  });
});
