import { describe, expect, it } from "vitest";
import { addDays, localDateTimeToIso, localLabel, localToday, startOfLocalDay, startOfWeek, tokenRange, zonedParts } from "./dates";

describe("timezone helpers", () => {
  it("finds local midnight in UTC, across DST changes", () => {
    expect(startOfLocalDay({ year: 2026, month: 7, day: 1 }, "America/Los_Angeles").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 12, day: 1 }, "America/Los_Angeles").toISOString()).toBe("2026-12-01T08:00:00.000Z");
    // DST starts 2026-03-08 in Vancouver: midnight is still PST (UTC-8)
    expect(startOfLocalDay({ year: 2026, month: 3, day: 8 }, "America/Los_Angeles").toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 3, day: 9 }, "America/Los_Angeles").toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 6, day: 1 }, "Asia/Kolkata").toISOString()).toBe("2026-05-31T18:30:00.000Z");
    expect(startOfLocalDay({ year: 2026, month: 6, day: 1 }, "UTC").toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("knows what day it is locally", () => {
    const instant = new Date("2026-11-24T05:00:00Z"); // 21:00 on the 23rd in Vancouver
    expect(localToday(instant, "America/Los_Angeles")).toEqual({ year: 2026, month: 11, day: 23 });
    expect(localToday(instant, "Europe/Amsterdam")).toEqual({ year: 2026, month: 11, day: 24 });
    expect(zonedParts(instant, "America/Los_Angeles").hour).toBe(21);
  });

  it("does date arithmetic", () => {
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(startOfWeek({ year: 2026, month: 11, day: 29 })).toEqual({ year: 2026, month: 11, day: 23 }); // Sun → Mon
    expect(startOfWeek({ year: 2026, month: 11, day: 23 })).toEqual({ year: 2026, month: 11, day: 23 });
  });

  it("resolves tokens to local ranges", () => {
    const now = new Date("2026-12-31T20:00:00Z");
    expect(tokenRange("@today", now, "UTC")).toEqual({ start: { year: 2026, month: 12, day: 31 }, end: { year: 2027, month: 1, day: 1 } });
    expect(tokenRange("@this_month", now, "UTC").end).toEqual({ year: 2027, month: 1, day: 1 });
    expect(tokenRange("@yesterday", now, "UTC").start).toEqual({ year: 2026, month: 12, day: 30 });
  });
});

describe("clock changes", () => {
  it("opening hours follow the time zone database on each date (Los Angeles changes clocks)", () => {
    const at9 = (y: number, m: number, d: number, tz: string) => localDateTimeToIso(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T09:00`, tz);
    expect(at9(2026, 10, 30, "America/Los_Angeles")).toBe("2026-10-30T16:00:00.000Z"); // PDT
    expect(at9(2026, 11, 27, "America/Los_Angeles")).toBe("2026-11-27T17:00:00.000Z"); // PST after 1 Nov
    expect(at9(2026, 3, 9, "America/Los_Angeles")).toBe("2026-03-09T16:00:00.000Z"); // PDT after 8 Mar
    expect(at9(2026, 11, 27, "Europe/Amsterdam")).toBe("2026-11-27T08:00:00.000Z");
  });
  it("every 9:00 agrees with what Intl says the wall clock is, all year", () => {
    for (const tz of ["America/Vancouver", "America/Los_Angeles", "Europe/London", "Australia/Sydney"]) {
      for (let day = 0; day < 365; day += 3) {
        const d = new Date(Date.UTC(2026, 0, 1 + day));
        const iso = localDateTimeToIso(`${d.toISOString().slice(0, 10)}T09:00`, tz)!;
        expect(localLabel(iso, tz).slice(11, 16), `${tz} ${iso}`).toBe("09:00");
      }
    }
  });
});
