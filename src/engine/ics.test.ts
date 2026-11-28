import { describe, expect, it } from "vitest";
import { icsFeed } from "./ics";

describe("icsFeed", () => {
  it("writes valid events with escaped, folded text", () => {
    const out = icsFeed("Mila, bookings", [
      { id: "b1", start: "2026-12-01T17:00:00.000Z", end: "2026-12-01T18:00:00.000Z", title: "Cut; Ana", description: "Line one\nLine two " + "x".repeat(100) },
      { id: "bad", start: "nope", end: "nope", title: "skip" },
    ], new Date("2026-11-28T00:00:00Z"));
    expect(out).toContain("X-WR-CALNAME:Mila\\, bookings");
    expect(out).toContain("DTSTART:20261201T170000Z");
    expect(out).toContain("SUMMARY:Cut\; Ana");
    expect(out).not.toContain("skip");
    expect(out.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
