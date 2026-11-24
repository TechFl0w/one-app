import { describe, expect, it } from "vitest";
import { TEMPLATES, type Answers, type Question } from ".";
import { validateRecordInput, tableOrThrow } from "@/engine/records";
import { loadBlockData } from "@/engine/blockData";
import { memoryStore } from "@/engine/store";

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

  it("seeds records that validate against their tables", () => {
    const { blueprint, seed } = template.build(business, {});
    for (const s of seed) expect(() => validateRecordInput(tableOrThrow(blueprint, s.table), s.data, "create")).not.toThrow();
  });

  it("every block loads without errors on the seeded data", async () => {
    for (const answers of answerSets(template.questions).slice(0, 12)) {
      const { blueprint, seed } = template.build(business, answers);
      const rows = seed.map((s, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, tableId: s.table, data: s.data, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }));
      const store = memoryStore(rows);
      for (const p of blueprint.pages) {
        for (const b of p.layout.blocks) {
          const data = await loadBlockData(b, blueprint, store);
          expect(data.kind, `${template.id} ${p.id}/${b.id}: ${"message" in data ? data.message : ""}`).not.toBe("error");
        }
      }
    }
  });
});

describe("template answers", () => {
  it("uses the owner's lists and options", () => {
    const salon = TEMPLATES.find((t) => t.id === "nail_salon")!;
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
