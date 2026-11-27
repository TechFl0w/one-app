import { describe, expect, it } from "vitest";
import { daysBetween, layoutLanes } from "./lanes";

describe("layoutLanes", () => {
  it("puts overlapping events side by side and leaves the rest full width", () => {
    const r = layoutLanes([
      { id: "a", start: 9, end: 12 },
      { id: "b", start: 10, end: 11 },
      { id: "c", start: 11, end: 13 },
      { id: "d", start: 14, end: 15 },
    ]);
    const by = Object.fromEntries(r.map((x) => [x.id, [x.lane, x.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2], d: [0, 1] });
  });
  it("touching events don't overlap", () => {
    const r = layoutLanes([{ start: 9, end: 10 }, { start: 10, end: 11 }]);
    expect(r.map((x) => x.lanes)).toEqual([1, 1]);
  });
});

describe("daysBetween", () => {
  it("lists every day of a multi-day job", () => {
    expect(daysBetween("2026-11-30", "2026-12-02")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(daysBetween("2026-11-30", "2026-11-29")).toEqual(["2026-11-30"]);
  });
});
