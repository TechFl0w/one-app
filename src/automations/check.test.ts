import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/templates";
import type { Automation } from "@/schema/blueprint";
import { automationIssues, messageVars } from "./check";

const salon = TEMPLATES.find((t) => t.id === "appointments")!.build({ name: "Studio Mila", timezone: "America/Vancouver" }, {});
const bp = salon.blueprint;
const bookings = bp.scheduling!.bookings.table;
const t = bp.tables.find((x) => x.id === bookings)!;
const client = t.fields.find((f) => f.type === "link" && f.to === bp.scheduling!.clients.table)!;
const start = bp.scheduling!.bookings.start;

const auto = (actions: Automation["actions"]): Automation => ({ id: "aut_t", label: "Test", enabled: true, trigger: { type: "record_created", table: bookings }, conditions: [], actions });

describe("automation steps are checked when saved", () => {
  it("every template's automations pass", () => {
    for (const tpl of TEMPLATES) {
      const b = tpl.build({ name: "X", timezone: "UTC" }, {}).blueprint;
      for (const a of b.automations) expect(automationIssues(b, a), `${tpl.id} ${a.label}`).toEqual([]);
    }
  });
  it("a guessed message format is refused with what's expected", () => {
    const issues = automationIssues(bp, auto([{ type: "send_message", recipient: "client", subject: "Booked!", body: "See you {{start_time}}" }]));
    expect(issues.join(" ")).toMatch(/doesn't use “recipient”, “subject”, “body”/);
    expect(issues.join(" ")).toMatch(/needs a “message”/);
  });
  it("placeholders must exist; a link can be followed one step", () => {
    const ok = automationIssues(bp, auto([{ type: "send_message", to: client.id, message: `Hi {{name}}, see you {{${start}}} — {{${client.id}.fld_nope}}` }]));
    expect(ok).toEqual([expect.stringMatching(/fld_nope isn't a field/)]);
    expect(automationIssues(bp, auto([{ type: "notify", message: "{{start_time}}" }]))[0]).toMatch(/use field ids/);
    expect(automationIssues(bp, auto([{ type: "send_message", to: start, message: "x" }]))[0]).toMatch(/must be an email or phone field, or a link/);
    expect(automationIssues(bp, auto([{ type: "wait", duration: "tomorrow" }]))[0]).toMatch(/duration/);
  });
});

describe("messages read like a person wrote them", () => {
  it("dates in the business's time, linked names, money", async () => {
    const data = { [start]: "2026-11-27T22:00:00.000Z", [client.id]: "c1" };
    const vars = await messageVars(bp, bookings, data, [`{{${start}}} {{${client.id}}}`], async () => ({ [bp.tables.find((x) => x.id === bp.scheduling!.clients.table)!.primaryField!]: "Ava Thompson" }));
    expect(vars[start]).toMatch(/Fri, Nov 27, 3:00/);
    expect(vars[client.id]).toBe("Ava Thompson");
  });
});
