import { describe, expect, it } from "vitest";
import { guessName, guessTemplate } from "./guess";
import { templateById } from ".";

describe("onboarding's open question", () => {
  it.each([
    ["I run a hair salon and want online booking", "appointments", { kind: "hair" }],
    ["Small nail studio, 2 techs, need fewer no-shows", "appointments", { kind: "nails", extras: ["reminders", "deposits"] }],
    ["I'm a landscaper and need to send quotes and invoices", "contractor", { trade: "landscaping" }],
    ["Electrician — quotes, jobs and getting paid", "contractor", { trade: "electrical" }],
    ["We fix cars, 4 bays, need a workshop board", "mechanic", {}],
    ["I rent out chairs in my salon to other stylists", "chair_rental", {}],
    ["I make candles and sell on Etsy", "maker_shop", {}],
    ["Physiotherapy clinic with 3 therapists", "appointments", { kind: "health" }],
  ])("%s", (text, template, answers) => {
    const g = guessTemplate(text)!;
    expect(g.templateId).toBe(template);
    expect(g.answers).toEqual(answers);
    expect(templateById(g.templateId)).toBeTruthy();
  });
  it("what they need help with switches it on", () => {
    expect(guessTemplate("hair salon, want online booking and fewer no-shows")!.answers).toEqual({ kind: "hair", extras: ["reminders", "deposits"] });
  });
  it("nothing to go on → no guess", () => expect(guessTemplate("hello")).toBeNull());
  it("names it when it can", () => {
    expect(guessName("I run Studio Mila, a hair salon with 3 stylists")).toBe("Studio Mila");
    expect(guessName("hair salon")).toBeNull();
  });
});
