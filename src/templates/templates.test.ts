import { describe, expect, it } from "vitest";
import { TEMPLATES, type Answers, type Question } from ".";
import { resolveSeed } from "./types";
import { validateRecordInput, tableOrThrow } from "@/engine/records";
import { loadBlockData } from "@/engine/blockData";
import { memoryStore } from "@/engine/store";
import { checkDataRules } from "@/engine/dataRules";
import { menuCounts } from "@/engine/menuCounts";
import { withComputed } from "@/engine/computed";

const business = { name: "Test Co", timezone: "America/Los_Angeles" };

/** Every subset of a multi-select (small), plus defaults and empty answers. */
function answerSets(questions: Question[]): Answers[] {
  const sets: Answers[] = [{}];
  for (const q of questions) {
    if (q.kind !== "multi") continue;
    const ids = q.options.map((o) => o.id);
    const subsets = Array.from({ length: 1 << ids.length }, (_, mask) => ids.filter((_, i) => mask & (1 << i)));
    for (const s of subsets) sets.push({ [q.id]: s });
  }
  const choiceQs = questions.filter((q) => q.kind === "choice");
  for (const q of choiceQs) for (const o of q.options) sets.push({ [q.id]: o.id });
  sets.push(Object.fromEntries(questions.map((q) => [q.id, q.kind === "list" ? [] : q.kind === "multi" ? [] : "nonsense"])));
  return sets;
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))("template %s", (_id, template) => {
  it("builds a valid blueprint for every combination of answers", () => {
    for (const answers of answerSets(template.questions)) {
      const { blueprint } = template.build(business, answers);
      expect(blueprint.version).toBe(1);
      expect(blueprint.business).toMatchObject({ name: "Test Co", timezone: "America/Los_Angeles", type: template.businessType });
      expect(blueprint.pages.length).toBeGreaterThan(0);
    }
  });

  it("follows the data rules (statuses follow dates, sends re-check who they're for)", () => {
    for (const answers of answerSets(template.questions)) expect(checkDataRules(template.build(business, answers).blueprint)).toEqual([]);
  });

  it("seeds records that validate against their tables", () => {
    const { blueprint, seed } = template.build(business, {});
    // Links between seeds ("@ref:x") resolve to ids of seeds created before them.
    const ids = new Map<string, string>();
    seed.forEach((s, i) => {
      for (const v of Object.values(s.data)) if (typeof v === "string" && v.startsWith("@ref:")) expect(ids.has(v.slice(5)), `${s.table} ${v}`).toBe(true);
      expect(() => validateRecordInput(tableOrThrow(blueprint, s.table), resolveSeed(s.data, ids), "create")).not.toThrow();
      if (s.ref) ids.set(s.ref, `00000000-0000-4000-8000-${String(900000000000 + i)}`);
    });
  });

  it("every block loads without errors on the seeded data", async () => {
    for (const answers of answerSets(template.questions).slice(0, 12)) {
      const { blueprint, seed } = template.build(business, answers);
      const ids = new Map<string, string>();
      const rows = seed.map((s, i) => {
        const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        const row = { id, tableId: s.table, data: resolveSeed(s.data, ids), createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
        if (s.ref) ids.set(s.ref, id);
        return row;
      });
      const store = memoryStore(rows);
      for (const p of blueprint.pages) {
        // Record pages load for one of their records (the first seeded one, if any).
        const recordId = p.recordOf ? rows.find((r) => r.tableId === p.recordOf)?.id : undefined;
        if (p.recordOf && !recordId) continue;
        for (const b of p.layout.blocks) {
          const data = await loadBlockData(b, blueprint, store, { recordId });
          expect(data.kind, `${template.id} ${p.id}/${b.id}: ${"message" in data ? data.message : ""}`).not.toBe("error");
        }
      }
    }
  });
});

describe("template answers", () => {
  it("uses the owner's lists and options", () => {
    const salon = TEMPLATES.find((t) => t.id === "appointments")!;
    const built = salon.build(business, { team: ["Mai", " Priya ", "Mai", ""], extras: ["stations", "deposits"] });
    expect(built.seed.filter((s) => s.table === "tbl_team").map((s) => s.data.fld_name)).toEqual(["Mai", "Priya"]);
    expect(built.blueprint.tables.map((t) => t.id)).toContain("tbl_stations");
    expect(built.blueprint.modules).toContain("payments");
    expect(built.blueprint.automations).toEqual([]);

    const shop = TEMPLATES.find((t) => t.id === "maker_shop")!;
    const orders = shop.build(business, { channels: ["markets", "bogus"] }).blueprint.tables.find((t) => t.id === "tbl_orders")!;
    const channel = orders.fields.find((f) => f.id === "fld_channel");
    expect(channel && "options" in channel ? channel.options.map((o) => o.label) : []).toEqual(["Market"]);
  });
});

describe("appointments booking", () => {
  it("is bookable right after onboarding", async () => {
    const { availableSlots, catalog } = await import("@/booking/service");
    const { memoryBackend } = await import("@/agent/memoryBackend");
    const salon = TEMPLATES.find((t) => t.id === "appointments")!;
    for (const extras of [[], ["stations"]]) {
      const { blueprint, seed } = salon.build(business, { team: ["Mai", "Priya"], opening: JSON.stringify({ mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]] }), extras });
      let n = 0;
      const records = seed.map((s) => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, tableId: s.table, data: s.data, createdAt: "", updatedAt: "" }));
      const { backend } = memoryBackend({ blueprint, records });
      const c = await catalog(blueprint, backend);
      expect(c.practitioners.map((p) => p.name)).toEqual(["Mai", "Priya"]);
      const slots = await availableSlots(blueprint, backend, { serviceId: c.services[0].id, from: { year: 2026, month: 12, day: 7 }, days: 1 }, new Date("2026-12-01T00:00:00Z"));
      expect(slots.length).toBeGreaterThan(20); // Monday 9–5, 15-minute steps
      if (extras.length) expect(slots[0].resourceId).toBeDefined();
    }
  });
});

describe("appointments questions", () => {
  it("words questions and suggests services from the kind of appointments", async () => {
    const { resolve, initialValue, hours } = await import("./types");
    const t = TEMPLATES.find((x) => x.id === "appointments")!;
    const [kind, team, services, opening] = t.questions;
    expect(resolve(team.label, { kind: "hair" })).toBe("Who does the hair?");
    expect(initialValue(services, { kind: "hair" })).toEqual(["Haircut", "Colour", "Blow-dry"]);
    expect(t.build(business, { kind: "hair" }).seed.filter((s) => s.table === "tbl_services").map((s) => s.data.fld_name)).toEqual(["Haircut", "Colour", "Blow-dry"]);
    expect(kind.kind).toBe("choice");
    // Hours come from the editor as JSON; bad input falls back to the default.
    if (opening.kind !== "hours") throw new Error("hours question");
    expect(hours({ opening: JSON.stringify({ sun: [["10:00", "14:00"]] }) }, opening)).toEqual({ sun: [["10:00", "14:00"]] });
    expect(hours({ opening: "{bad" }, opening)).toEqual(opening.default);
    expect(hours({ opening: JSON.stringify({ funday: [["1", "2"]] }) }, opening)).toEqual(opening.default);
  });
});

describe("mechanic dashboard", () => {
  const mech = TEMPLATES.find((t) => t.id === "mechanic")!;
  const { blueprint, seed } = mech.build(business, {});
  const ids = new Map<string, string>();
  const rows = seed.map((s, i) => {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const row = { id, tableId: s.table, data: resolveSeed(s.data, ids), createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" };
    if (s.ref) ids.set(s.ref, id);
    return row;
  });
  const store = withComputed(memoryStore(rows), blueprint);

  it("shows live counts next to pages in the menu", async () => {
    const counts = await menuCounts(blueprint, store);
    expect(counts.pg_workshop?.value).toBeGreaterThan(0);
    expect(counts.pg_jobs).toMatchObject({ label: "late", tone: "red" });
    expect(Object.keys(counts)).not.toContain("pg_calendar");
  });

  it("the greeting's line counts cars, drop-offs, late jobs and money to collect", async () => {
    const header = blueprint.pages.find((p) => p.id === "pg_today")!.layout.blocks.find((b) => b.type === "header")!;
    const data = await loadBlockData(header, blueprint, store);
    expect(data.kind).toBe("header");
    if (data.kind !== "header") return;
    expect(data.stats.map((s) => s.label.split("|").pop())).toEqual(["cars in the shop", "drop-offs today", "late", "to collect"]);
    expect(data.stats.every((s) => typeof s.value === "number")).toBe(true);
    expect(data.stats[3].field?.type).toBe("formula");
  });
});
