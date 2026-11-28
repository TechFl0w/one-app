import { describe, expect, it } from "vitest";
import { Blueprint } from "@/schema/blueprint";
import { demoBlueprint } from "@/demo/salon";
import { TEMPLATES } from "@/templates";
import { defaultSite } from "./site";
import { applyChangeSet } from "./changeSet";

describe("default website", () => {
  it("a salon gets booking, services, team, hours and a contact form that adds clients", () => {
    const site = defaultSite(demoBlueprint);
    expect(site.sections.map((s) => s.type)).toEqual(["hero", "services", "team", "hours", "contact"]);
    expect(site.sections[0]).toMatchObject({ cta: "book", title: demoBlueprint.business.name });
    expect(site.contact?.table).toBe(demoBlueprint.scheduling!.clients.table);
    // It's a valid part of the blueprint, set through a change set (and undoable).
    const r = applyChangeSet(demoBlueprint, { baseVersion: demoBlueprint.version, source: "ui", ops: [{ op: "setSite", site }] });
    expect(Blueprint.parse(r.blueprint).site?.sections).toHaveLength(5);
  });
  it("a contractor without booking asks for a quote", () => {
    const bp = TEMPLATES.find((t) => t.id === "contractor")!.build({ name: "Green Edge", timezone: "America/Vancouver" }, {}).blueprint;
    const site = defaultSite(bp);
    expect(site.sections.map((s) => s.type)).toEqual(["hero", "contact"]);
    expect(site.sections[0]).toMatchObject({ cta: "contact" });
  });
});
