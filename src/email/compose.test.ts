import { describe, expect, it } from "vitest";
import { composeEmail, emailDomains, inboundAddress, parseAddress, renderTemplate, resolveRecipient, safeDisplayName, slugFromRecipients, slugify, type EmailSettings } from "./compose";
import { demoBlueprint, demoRecords } from "@/demo/salon";

const d = emailDomains({});
const settings: EmailSettings = { businessId: "b1", slug: "polished-nail-bar", fromName: "Polished Nail Bar", replyMode: "inbound", ownerEmail: "mai@gmail.com", forwardToOwner: true };

describe("addresses", () => {
  it("slugifies business names", () => {
    expect(slugify("Polished Nail Bar")).toBe("polished-nail-bar");
    expect(slugify("Café Crème & Co!!")).toBe("cafe-creme-co");
    expect(slugify("✨")).toBe("biz-x");
    expect(slugify("A very long business name that keeps going and going")).toHaveLength(32);
  });

  it("sends from the shared domain under the business name, replies to inbound or owner", () => {
    const m = composeEmail(settings, d, { to: "ava@example.com", subject: "Hi\r\nBcc: evil@x.com", text: "Hello" });
    expect(m).toEqual({
      from: '"Polished Nail Bar" <hello@mail.buildingwaves.tech>',
      to: "ava@example.com",
      replyTo: "polished-nail-bar@in.buildingwaves.tech",
      subject: "Hi Bcc: evil@x.com",
      text: "Hello",
      headers: { "X-One-Business": "b1" },
    });
    expect(composeEmail({ ...settings, replyMode: "owner" }, d, { to: "a@b.co", subject: "x", text: "y" }).replyTo).toBe("mai@gmail.com");
    expect(() => composeEmail(settings, d, { to: "not an email", subject: "x", text: "y" })).toThrow();
    expect(safeDisplayName('Evil "Name" <x@y>\r\nBcc: z')).toBe("Evil Name x@y Bcc: z");
  });

  it("finds the business from inbound recipients", () => {
    expect(parseAddress('"Ava T" <AVA@Example.com>')).toEqual({ name: "Ava T", email: "ava@example.com" });
    expect(slugFromRecipients(["someone@else.com", "Shop <polished-nail-bar@in.buildingwaves.tech>"], d)).toBe("polished-nail-bar");
    expect(slugFromRecipients(["x@in.buildingwaves.tech.evil.com"], d)).toBeNull();
    expect(inboundAddress("abc", d)).toBe("abc@in.buildingwaves.tech");
  });
});

describe("templates", () => {
  it("fills known templates, falls back to the step's message", () => {
    expect(renderTemplate("tpl_shipped", undefined, { business: "Glass Co", name: "Ava", tracking: "1Z9", data: {} })).toEqual({
      subject: "Your order is on its way",
      text: "Hi Ava,\n\nGood news: your order has shipped. Tracking: 1Z9\n\nThank you for your order!\n\nGlass Co",
    });
    expect(renderTemplate(undefined, "Your total is {{fld_total}}", { business: "Glass Co", data: { fld_total: 42 } })).toEqual({
      subject: "A message from Glass Co",
      text: "Your total is 42",
    });
  });
});

describe("resolveRecipient", () => {
  const rows = demoRecords();
  const get = async (t: string, id: string) => rows.find((r) => r.tableId === t && r.id === id)?.data ?? null;

  it("follows a link to the client's email", async () => {
    const booking = rows.find((r) => r.id.endsWith("30"))!; // Ava (has email)
    expect(await resolveRecipient(demoBlueprint, "tbl_bookings", booking.data, "fld_client", get)).toEqual({ email: "ava@example.com", name: "Ava Thompson" });
    const ben = rows.find((r) => r.id.endsWith("31"))!; // Ben has no email
    expect(await resolveRecipient(demoBlueprint, "tbl_bookings", ben.data, "fld_client", get)).toBeNull();
  });

  it("uses an email field directly, or finds one when no field is given", async () => {
    expect(await resolveRecipient(demoBlueprint, "tbl_clients", { fld_name: "Zoe", fld_email: "zoe@x.com" }, "fld_email", get)).toEqual({ email: "zoe@x.com", name: "Zoe" });
    expect(await resolveRecipient(demoBlueprint, "tbl_clients", { fld_name: "Zoe", fld_email: "zoe@x.com" }, undefined, get)).toMatchObject({ email: "zoe@x.com" });
  });
});
