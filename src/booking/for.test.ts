import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { memoryBackend } from "@/agent/memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { availableSlots, bookSlot, catalog } from "./service";
import { atLocal } from "./slots";

const TZ = demoBlueprint.business.timezone;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GEL = id(20);
const MAI = id(1);
const WED = { year: 2026, month: 12, day: 2 };
const now = new Date("2026-11-30T12:00:00Z");
const local = (hm: string) => new Date(atLocal(WED, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), TZ)).toISOString();

// The sample salon, turned into a groomer: bookings are for a pet, and a giant dog takes longer.
const SIZES = [{ id: "opt_small", label: "Small" }, { id: "opt_giant", label: "Giant" }];
const bp = Blueprint.parse({
  ...demoBlueprint,
  tables: [
    ...demoBlueprint.tables.map((t) => (t.id === "tbl_bookings" ? { ...t, fields: [...t.fields, { id: "fld_pet", label: "Pet", type: "link", to: "tbl_pets" }] } : t)),
    {
      id: "tbl_pets",
      label: "Pets",
      primaryField: "fld_pet_name",
      fields: [
        { id: "fld_pet_name", label: "Name", type: "text", required: true },
        { id: "fld_pet_owner", label: "Owner", type: "link", to: "tbl_clients" },
        { id: "fld_size", label: "Size", type: "choice", options: SIZES },
        { id: "fld_breed", label: "Breed", type: "text" },
        { id: "fld_vaccines", label: "Vaccines valid until", type: "date" },
      ],
    },
    {
      id: "tbl_variants",
      label: "Prices by size",
      primaryField: "fld_v_service",
      fields: [
        { id: "fld_v_service", label: "Service", type: "link", to: "tbl_services" },
        { id: "fld_v_size", label: "Size", type: "choice", options: [{ id: "opt_v_small", label: "Small" }, { id: "opt_v_giant", label: "giant" }] },
        { id: "fld_v_minutes", label: "Minutes", type: "number" },
        { id: "fld_v_price", label: "Price", type: "money" },
      ],
    },
  ],
  scheduling: {
    ...demoBlueprint.scheduling!,
    for: { table: "tbl_pets", booking: "fld_pet", client: "fld_pet_owner", name: "fld_pet_name", kind: "fld_size", ask: ["fld_breed"] },
    variants: { table: "tbl_variants", service: "fld_v_service", kind: "fld_v_size", duration: "fld_v_minutes", price: "fld_v_price" },
    requirements: [{ on: "for", field: "fld_vaccines", rule: "valid_on_date", label: "Vaccines valid on the day" }],
  },
});

function setup() {
  let n = 0;
  const rows = [
    ...demoRecords().filter((r) => r.tableId !== "tbl_bookings"),
    { id: id(950), tableId: "tbl_variants", createdAt: now.toISOString(), updatedAt: now.toISOString(), data: { fld_v_service: GEL, fld_v_size: "opt_v_giant", fld_v_minutes: 150, fld_v_price: 120 } },
  ];
  return memoryBackend({ blueprint: bp, records: rows }, () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`);
}

describe("booking for a pet", () => {
  it("offers kinds, questions and the variant by size", async () => {
    const c = await catalog(bp, setup().backend);
    expect(c.for).toMatchObject({ label: "pet", kinds: SIZES, ask: [{ id: "fld_breed", label: "Breed" }] });
    expect(c.services.find((s) => s.id === GEL)?.variants).toEqual({ opt_giant: { durationMin: 150, price: 120 } });
    expect(c.requirements?.[0]).toMatchObject({ label: "Vaccines valid on the day", field: { id: "fld_vaccines", type: "date" } });
  });

  it("a giant dog takes the variant's time", async () => {
    const { backend } = setup();
    const small = await availableSlots(bp, backend, { serviceId: GEL, practitionerId: MAI, from: WED, days: 1, kind: "opt_small" }, now);
    const giant = await availableSlots(bp, backend, { serviceId: GEL, practitionerId: MAI, from: WED, days: 1, kind: "opt_giant" }, now);
    expect(Date.parse(small[0].end) - Date.parse(small[0].start)).toBe(60 * 60_000);
    expect(Date.parse(giant[0].end) - Date.parse(giant[0].start)).toBe(150 * 60_000);
  });

  it("asks for what's missing, then books for a new pet under the client and reuses it next time", async () => {
    const { backend, state } = setup();
    const base = { serviceId: GEL, practitionerId: MAI, client: { name: "Lisa Moreau", email: "lisa@example.com" }, kind: "opt_giant" };
    await expect(bookSlot(bp, backend, { ...base, start: local("09:00"), for: { name: "Biscuit" } }, now)).rejects.toThrow(/Vaccines valid on the day/);
    await expect(bookSlot(bp, backend, { ...base, start: local("09:00"), for: { name: "Biscuit", values: { fld_vaccines: "2026-11-01" } } }, now)).rejects.toThrow(/Vaccines/);
    expect(state.records.filter((r) => r.tableId === "tbl_clients" && r.data.fld_name === "Lisa Moreau")).toHaveLength(0); // nothing made yet

    const r = await bookSlot(bp, backend, { ...base, start: local("09:00"), for: { name: "Biscuit", values: { fld_vaccines: "2027-06-01", fld_breed: "Great Dane", fld_nope: "x" } } }, now);
    const pet = state.records.find((x) => x.tableId === "tbl_pets")!;
    expect(pet.data).toMatchObject({ fld_pet_name: "Biscuit", fld_size: "opt_giant", fld_breed: "Great Dane", fld_vaccines: "2027-06-01" });
    expect(pet.data).not.toHaveProperty("fld_nope");
    const booking = state.records.find((x) => x.id === r.bookingId)!;
    expect(booking.data).toMatchObject({ fld_pet: pet.id, fld_amount: 120, fld_end: local("11:30") });

    // Next time: same client and pet by name (any case); vaccines are on file already.
    await bookSlot(bp, backend, { ...base, start: local("13:00"), for: { name: "biscuit" } }, now);
    expect(state.records.filter((x) => x.tableId === "tbl_pets")).toHaveLength(1);
  });
});
