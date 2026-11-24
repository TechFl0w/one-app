import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { availableSlots, bookSlot, catalog, expireHolds, hasUpcomingBooking } from "./service";
import { atLocal } from "./slots";

const TZ = demoBlueprint.business.timezone;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GEL = id(20);
const MAI = id(1);
const PRIYA = id(2);
const WED = { year: 2026, month: 12, day: 2 }; // Mai and Priya both work Wednesdays
const now = new Date("2026-11-30T12:00:00Z");
const local = (hm: string, day = WED) => new Date(atLocal(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), TZ)).toISOString();

function setup(extra: { tableId: string; data: Record<string, unknown> }[] = []) {
  let n = 0;
  const rows = [
    ...demoRecords().filter((r) => r.tableId !== "tbl_bookings"),
    ...extra.map((e, i) => ({ id: id(900 + i), createdAt: now.toISOString(), updatedAt: now.toISOString(), ...e })),
  ];
  return memoryBackend({ blueprint: demoBlueprint, records: rows }, () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`);
}

describe("booking service", () => {
  it("lists bookable services and people", async () => {
    const c = await catalog(demoBlueprint, setup().backend);
    expect(c.services.map((s) => s.name)).toEqual(["Classic pedicure", "Gel manicure", "Gel removal", "Nail art (per nail)"]);
    expect(c.practitioners.map((p) => p.name)).toEqual(["Mai", "Priya"]); // Jo isn't bookable online
    expect(c.services.find((s) => s.id === GEL)).toMatchObject({ durationMin: 60, price: 55 });
  });

  it("finds slots within each person's hours and around bookings plus cleanup", async () => {
    const { backend } = setup([
      { tableId: "tbl_bookings", data: { fld_client: id(10), fld_service: GEL, fld_practitioner: MAI, fld_start: local("09:00"), fld_end: local("10:00"), fld_status: "opt_booked" } },
      { tableId: "tbl_bookings", data: { fld_client: id(10), fld_service: GEL, fld_practitioner: MAI, fld_start: local("13:00"), fld_end: local("14:00"), fld_status: "opt_cancelled" } },
    ]);
    const mai = await availableSlots(demoBlueprint, backend, { serviceId: GEL, practitionerId: MAI, from: WED, days: 1 }, now);
    const starts = mai.map((s) => s.start);
    expect(starts).not.toContain(local("09:45")); // overlaps the 9–10 booking
    expect(starts).not.toContain(local("10:00")); // 10 minutes of cleanup after it
    expect(starts).toContain(local("10:15"));
    expect(starts).toContain(local("13:00")); // cancelled booking frees its time
    expect(starts.at(-1)).toBe(local("17:00")); // Mai works until 18:00 on Wednesdays
    const priya = await availableSlots(demoBlueprint, backend, { serviceId: GEL, practitionerId: PRIYA, from: WED, days: 1 }, now);
    expect(priya.at(-1)!.start).toBe(local("16:00")); // Priya until 17:00
  });

  it("books a slot, reuses known clients, and refuses a taken time", async () => {
    const { backend, state } = setup();
    const r = await bookSlot(demoBlueprint, backend, { serviceId: GEL, practitionerId: MAI, start: local("10:00"), client: { name: "Ava T", email: "AVA@example.com" } }, now);
    expect(r.state).toBe("requested");
    const booking = state.records.find((x) => x.id === r.bookingId)!;
    expect(booking.data).toMatchObject({ fld_client: id(10), fld_practitioner: MAI, fld_end: local("11:00"), fld_status: "opt_requested", fld_amount: 55 });
    await expect(bookSlot(demoBlueprint, backend, { serviceId: GEL, practitionerId: MAI, start: local("10:30"), client: { name: "Zed", phone: "+1 604 555 0199" } }, now)).rejects.toThrow(/no longer available/);

    const any = await bookSlot(demoBlueprint, backend, { serviceId: GEL, start: local("10:00"), client: { name: "Zed", phone: "+1 604 555 0199" } }, now);
    expect(any.slot.practitionerId).toBe(PRIYA); // Mai is taken at 10:00
    expect(state.records.filter((x) => x.tableId === "tbl_clients" && x.data.fld_name === "Zed")).toHaveLength(1);
  });

  it("validates requests", async () => {
    const { backend } = setup();
    await expect(bookSlot(demoBlueprint, backend, { serviceId: GEL, start: local("10:00"), client: { name: " " } }, now)).rejects.toThrow(/name/);
    await expect(bookSlot(demoBlueprint, backend, { serviceId: GEL, start: local("10:00"), client: { name: "X" } }, now)).rejects.toThrow(/email or phone/);
    await expect(bookSlot(demoBlueprint, backend, { serviceId: GEL, start: local("10:07"), client: { name: "X", phone: "+1 604 555 0100" } }, now)).rejects.toThrow(/no longer available/);
    await expect(availableSlots(demoBlueprint, backend, { serviceId: id(999) }, now)).rejects.toThrow(/isn’t available/);
  });

  it("expires holds so their time frees up", async () => {
    const bp = Blueprint.parse({
      ...demoBlueprint,
      tables: demoBlueprint.tables.map((t) => (t.id === "tbl_bookings" ? { ...t, fields: [...t.fields, { id: "fld_hold", label: "Held until", type: "datetime" }] } : t)),
      scheduling: { ...demoBlueprint.scheduling!, bookings: { ...demoBlueprint.scheduling!.bookings, holdUntil: "fld_hold" }, statuses: { ...demoBlueprint.scheduling!.statuses, held: "opt_requested" } },
    });
    const { backend, state } = memoryBackend({
      blueprint: bp,
      records: [
        ...demoRecords().filter((r) => r.tableId !== "tbl_bookings"),
        { id: id(950), tableId: "tbl_bookings", createdAt: "", updatedAt: "", data: { fld_client: id(10), fld_service: GEL, fld_practitioner: MAI, fld_start: local("10:00"), fld_end: local("11:00"), fld_status: "opt_requested", fld_hold: "2026-11-30T11:00:00Z" } },
      ],
    });
    expect(await expireHolds(bp, backend, now)).toBe(1);
    expect(state.records.find((r) => r.id === id(950))!.data.fld_status).toBe("opt_cancelled");
  });
});

describe("hasUpcomingBooking", () => {
  it("looks for the client's future bookings that still hold time", async () => {
    const past = { tableId: "tbl_bookings", recordId: id(800), data: { fld_client: id(10) } };
    const { backend } = setup([
      { tableId: "tbl_bookings", data: { fld_client: id(10), fld_service: GEL, fld_practitioner: MAI, fld_start: local("10:00"), fld_end: local("11:00"), fld_status: "opt_cancelled" } },
    ]);
    expect(await hasUpcomingBooking(demoBlueprint, backend, past, now)).toBe(false); // only a cancelled one
    await bookSlot(demoBlueprint, backend, { serviceId: GEL, start: local("12:00"), client: { name: "Ava", email: "ava@example.com" } }, now);
    expect(await hasUpcomingBooking(demoBlueprint, backend, past, now)).toBe(true);
    expect(await hasUpcomingBooking(demoBlueprint, backend, { tableId: "tbl_clients", recordId: id(10), data: {} }, now)).toBe(true);
    expect(await hasUpcomingBooking(demoBlueprint, backend, { tableId: "tbl_clients", recordId: id(11), data: {} }, now)).toBe(false);
  });
});

describe("scheduling schema", () => {
  it("rejects roles pointing at missing or wrong-typed fields", () => {
    const bad = { ...demoBlueprint, scheduling: { ...demoBlueprint.scheduling!, bookings: { ...demoBlueprint.scheduling!.bookings, start: "fld_notes", client: "fld_service" } } };
    const r = Blueprint.safeParse(bad);
    expect(r.success).toBe(false);
    const msgs = r.success ? [] : r.error.issues.map((i) => i.message);
    expect(msgs).toContain("fld_notes must be datetime");
    expect(msgs).toContain("fld_service must link to tbl_clients");
    const noCancel = { ...demoBlueprint, scheduling: { ...demoBlueprint.scheduling!, statuses: { requested: "opt_requested", confirmed: "opt_booked" } } };
    expect(Blueprint.safeParse(noCancel).success).toBe(false);
  });
});
