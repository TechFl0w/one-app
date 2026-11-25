import { describe, expect, it } from "vitest";
import { autoMap, buildRecords, inferField, parseCsv, parseDate, parseNumber } from "./csv";
import { demoBlueprint } from "@/demo/salon";

describe("CSV import", () => {
  it("parses quotes, newlines in quotes, BOM and other separators", () => {
    expect(parseCsv('﻿Name,Notes\r\n"Ava ""A"" T",\"line 1\nline 2\"\r\nBen,\n\n')).toEqual([["Name", "Notes"], ['Ava "A" T', "line 1\nline 2"], ["Ben", ""]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads numbers and dates the way spreadsheets write them", () => {
    expect(parseNumber("$1,234.50")).toBe(1234.5);
    expect(parseNumber("1.234,50 €")).toBe(1234.5);
    expect(parseNumber("(45)")).toBe(-45);
    expect(parseNumber("abc")).toBeNull();
    expect(parseDate("2026-03-14")).toEqual({ date: "2026-03-14" });
    expect(parseDate("3/14/2026")).toEqual({ date: "2026-03-14" });
    expect(parseDate("14/3/2026")).toEqual({ date: "2026-03-14" }); // day > 12 settles it
    expect(parseDate("04/05/26", "dmy")).toEqual({ date: "2026-05-04" });
    expect(parseDate("2026-03-14 2:30 pm")).toEqual({ date: "2026-03-14", time: "14:30" });
    expect(parseDate("hello")).toBeNull();
  });

  it("guesses field types for a new table", () => {
    const taken = new Set<string>();
    expect(inferField("Email", ["a@b.co", "c@d.org", ""], taken).type).toBe("email");
    expect(inferField("Mobile", ["604 555 0101", "+1 (604) 555-0102"], taken).type).toBe("phone");
    expect(inferField("Price", ["45", "60.50"], taken).type).toBe("money");
    expect(inferField("Visits", ["3", "12"], taken).type).toBe("number");
    expect(inferField("VIP", ["yes", "no", "yes"], taken).type).toBe("checkbox");
    expect(inferField("Last visit", ["2026-01-02", "3/4/2026"], taken).type).toBe("date");
    const tier = inferField("Tier", ["Gold", "Silver", "Gold", "Gold", "Silver", "Bronze"], taken);
    expect(tier.type).toBe("choice");
    expect(tier.type === "choice" && tier.options.map((o) => o.label)).toEqual(["Gold", "Silver", "Bronze"]);
    expect(inferField("Name", ["Ava", "Ben"], taken)).toMatchObject({ id: "fld_name", type: "text" });
    expect(inferField("Name", ["Ava"], taken).id).toBe("fld_name_2");
  });

  it("matches columns to existing fields and converts rows, reporting problems per row", () => {
    const clients = demoBlueprint.tables.find((t) => t.id === "tbl_clients")!;
    const headers = ["Full name", "WhatsApp", "E-mail", "VIP", "Shoe size"];
    const mapping = autoMap(headers, clients);
    expect(mapping).toEqual(["fld_name", "fld_whatsapp", "fld_email", "fld_vip", null]);
    const r = buildRecords(
      [
        ["Ava", "604 555 0101", "ava@x.com", "yes", "38"],
        ["", "604", "nope", "maybe", ""],
      ],
      mapping,
      clients,
      { timezone: "America/Vancouver", dateOrder: "mdy" },
    );
    expect(r.records).toEqual([{ fld_name: "Ava", fld_whatsapp: "604 555 0101", fld_email: "ava@x.com", fld_vip: true }]);
    expect(r.skipped).toBe(1);
    expect(r.problems.map((p) => `${p.row} ${p.field}: ${p.message}`)).toEqual(["2 Email: “nope” isn’t an email address", "2 VIP: “maybe” isn’t yes or no"]);
  });
});
