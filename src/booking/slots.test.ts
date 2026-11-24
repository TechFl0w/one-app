import { describe, expect, it } from "vitest";
import { atLocal, findSlots, weekday, workingRanges, type FindSlotsInput, type Interval } from "./slots";
import { blocksTime, canTransition, customerCanCancel, optionFor, stateOf } from "./lifecycle";
import type { Scheduling, WeeklyHours } from "@/schema/blueprint";

const TZ = "America/Los_Angeles";
const weekdays9to5: WeeklyHours = { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]] };
const MON = { year: 2026, month: 7, day: 6 }; // a Monday in PDT (UTC-7)

/** Local "HH:MM" on MON → ISO, for readable assertions. */
const at = (hm: string, day = MON) => new Date(atLocal(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), TZ)).toISOString();
const busy = (from: string, to: string, day = MON): Interval => ({ start: Date.parse(at(from, day)), end: Date.parse(at(to, day)) });
const times = (slots: { start: string }[]) =>
  slots.map((s) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(s.start)));

function input(over: Partial<FindSlotsInput> = {}): FindSlotsInput {
  return {
    timezone: TZ,
    now: new Date("2026-07-01T00:00:00Z"),
    from: MON,
    days: 1,
    businessHours: weekdays9to5,
    rules: { slotStepMin: 60, minNoticeMin: 0, horizonDays: 60 },
    service: { durationMin: 60 },
    practitioners: [{ id: "p_mai", busy: [] }],
    ...over,
  };
}

describe("working hours", () => {
  it("knows weekdays and intersects personal with business hours", () => {
    expect(weekday(MON)).toBe("mon");
    expect(weekday({ year: 2026, month: 7, day: 12 })).toBe("sun");
    expect(workingRanges(MON, weekdays9to5, { mon: [["07:00", "12:00"], ["13:00", "20:00"]] })).toEqual([
      [540, 720],
      [780, 1020],
    ]);
    expect(workingRanges(MON, weekdays9to5, { tue: [["09:00", "17:00"]] })).toEqual([]); // she doesn't work Mondays
    expect(workingRanges({ year: 2026, month: 7, day: 11 }, weekdays9to5)).toEqual([]); // Saturday closed
  });
});

describe("findSlots", () => {
  it("lists clock-aligned slots that fit before closing", () => {
    expect(times(findSlots(input()))).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    const s = findSlots(input({ rules: { slotStepMin: 15, minNoticeMin: 0, horizonDays: 60 }, service: { durationMin: 45 } }));
    expect(times(s).at(-1)).toBe("16:15");
    expect(s[0]).toEqual({ start: "2026-07-06T16:00:00.000Z", end: "2026-07-06T16:45:00.000Z", practitionerId: "p_mai" });
  });

  it("aligns to the clock even when hours start off-step", () => {
    const s = findSlots(input({ businessHours: { mon: [["09:10", "12:00"]] }, rules: { slotStepMin: 30, minNoticeMin: 0, horizonDays: 60 } }));
    expect(times(s)).toEqual(["09:30", "10:00", "10:30", "11:00"]);
  });

  it("avoids busy time including both buffers", () => {
    const base = input({ rules: { slotStepMin: 15, minNoticeMin: 0, horizonDays: 60 }, practitioners: [{ id: "p_mai", busy: [busy("11:00", "12:00")] }] });
    expect(times(findSlots(base)).filter((t) => t >= "10:00" && t <= "12:15")).toEqual(["10:00", "12:00", "12:15"]);
    const buffered = findSlots({ ...base, service: { durationMin: 60, bufferBeforeMin: 15, bufferAfterMin: 15 } });
    // needs [start-15, end+15] free: 09:45 would end its cleanup at 11:00 exactly (ok), 12:15 starts prep at 12:00 (ok)
    expect(times(buffered).filter((t) => t >= "09:30" && t <= "12:30")).toEqual(["09:30", "09:45", "12:15", "12:30"]); // 10:00–11:45 would overlap
  });

  it("respects minimum notice and the booking horizon", () => {
    const now = new Date(at("10:20"));
    expect(times(findSlots(input({ now, rules: { slotStepMin: 60, minNoticeMin: 120, horizonDays: 60 } })))[0]).toBe("13:00");
    expect(findSlots(input({ now: new Date("2026-04-01T00:00:00Z"), rules: { slotStepMin: 60, minNoticeMin: 0, horizonDays: 30 } }))).toEqual([]);
  });

  it("honours skills, a chosen practitioner, and daily maximums", () => {
    const practitioners = [{ id: "p_mai", busy: [] }, { id: "p_priya", busy: [], maxPerDay: 3, bookingsPerDay: { "2026-07-06": 3 } }];
    expect(findSlots(input({ practitioners, service: { durationMin: 60, practitionerIds: ["p_priya"] } }))).toEqual([]);
    expect(new Set(findSlots(input({ practitioners })).map((s) => s.practitionerId))).toEqual(new Set(["p_mai"]));
    expect(findSlots(input({ practitioners, practitionerId: "p_priya" }))).toEqual([]);
    expect(findSlots(input({ practitioners: [{ id: "p_x", busy: [], hours: { tue: [["09:00", "17:00"]] } }] }))).toEqual([]);
  });

  it("with 'any practitioner' returns one slot per time and packs bookings tightly", () => {
    const practitioners = [
      { id: "p_a", busy: [busy("09:00", "10:00")] }, // free from 10:00, adjacent to a booking
      { id: "p_b", busy: [] }, // completely free
    ];
    const s = findSlots(input({ practitioners }));
    expect(times(s)).toEqual(["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
    expect(s.find((x) => times([x])[0] === "10:00")!.practitionerId).toBe("p_a"); // fills the gap next to her booking
    expect(s.find((x) => times([x])[0] === "09:00")!.practitionerId).toBe("p_b");
  });

  it("needs a free resource of the right type", () => {
    const resources = [
      { id: "r_chair_1", type: "Chair", busy: [busy("09:00", "12:00")] },
      { id: "r_spa_1", type: "Pedicure", busy: [] },
    ];
    const s = findSlots(input({ resources, service: { durationMin: 60, resourceType: "chair" } }));
    expect(times(s)[0]).toBe("12:00");
    expect(s[0].resourceId).toBe("r_chair_1");
    expect(findSlots(input({ resources, service: { durationMin: 60, resourceType: "Laser" } }))).toEqual([]);
    expect(findSlots(input({ resources: [] }))).toEqual([]);
    expect(findSlots(input({ resources: null })).length).toBe(8);
  });

  it("is correct across DST changes", () => {
    // 2026-03-08: clocks jump 02:00 → 03:00 in Los Angeles. Sunday — open it for this test.
    const sunday = { year: 2026, month: 3, day: 8 };
    const s = findSlots(input({ from: sunday, now: new Date("2026-03-01T00:00:00Z"), businessHours: { sun: [["01:00", "05:00"]] }, rules: { slotStepMin: 60, minNoticeMin: 0, horizonDays: 60 } }));
    // 01:00 PST = 09:00Z; 02:00 doesn't exist (→ 03:00 PDT = 10:00Z); 03:00 PDT = 10:00Z; 04:00 PDT = 11:00Z
    expect(s.map((x) => x.start)).toEqual(["2026-03-08T09:00:00.000Z", "2026-03-08T10:00:00.000Z", "2026-03-08T11:00:00.000Z"]);
    for (const x of s) expect(Date.parse(x.end) - Date.parse(x.start)).toBe(3_600_000);

    // A normal 09:00 slot is 16:00Z in summer and 17:00Z in winter.
    const winter = findSlots(input({ from: { year: 2026, month: 1, day: 5 }, now: new Date("2026-01-01T00:00:00Z") }));
    expect(winter[0].start).toBe("2026-01-05T17:00:00.000Z");
    expect(findSlots(input())[0].start).toBe("2026-07-06T16:00:00.000Z");
  });

  it("works in other timezones and over several days", () => {
    const s = findSlots(input({ timezone: "Asia/Kolkata", days: 7, now: new Date("2026-07-01T00:00:00Z") }));
    expect(s[0].start).toBe("2026-07-06T03:30:00.000Z"); // 09:00 IST
    expect(s.length).toBe(5 * 8); // Mon–Fri
  });

  it("is deterministic", () => {
    const i = input({ practitioners: [{ id: "p_b", busy: [] }, { id: "p_a", busy: [] }], days: 3 });
    expect(findSlots(i)).toEqual(findSlots(structuredClone(i)));
    expect(findSlots(i)[0].practitionerId).toBe("p_a"); // equal score and load → id order
  });
});

describe("lifecycle", () => {
  const sc = {
    statuses: { requested: "opt_requested", confirmed: "opt_booked", completed: "opt_done", paid: "opt_done", cancelled: "opt_cancelled", no_show: "opt_no_show" },
  } as unknown as Scheduling;

  it("allows only forward transitions", () => {
    expect(canTransition("requested", "confirmed")).toBe(true);
    expect(canTransition("confirmed", "no_show")).toBe(true);
    expect(canTransition("completed", "requested")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });

  it("maps options to states (most advanced wins) and back", () => {
    expect(stateOf(sc, "opt_done")).toBe("paid");
    expect(stateOf(sc, "opt_booked")).toBe("confirmed");
    expect(stateOf(sc, "opt_unknown")).toBe("confirmed");
    expect(optionFor(sc, "held")).toBe("opt_requested");
    expect(optionFor(sc, "checked_in")).toBe("opt_booked");
  });

  it("releases time for cancelled, no-show and expired holds", () => {
    const now = new Date("2026-07-06T10:00:00Z");
    expect(blocksTime("confirmed", null, now)).toBe(true);
    expect(blocksTime("cancelled", null, now)).toBe(false);
    expect(blocksTime("held", "2026-07-06T09:59:00Z", now)).toBe(false);
    expect(blocksTime("held", "2026-07-06T10:15:00Z", now)).toBe(true);
    expect(customerCanCancel("2026-07-07T10:00:00Z", now, 24)).toBe(true);
    expect(customerCanCancel("2026-07-07T09:00:00Z", now, 24)).toBe(false);
  });
});
