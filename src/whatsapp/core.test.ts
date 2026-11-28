import { describe, expect, it } from "vitest";
import twilio from "twilio";
import { inSessionWindow, lineStatusFromSender, parseInbound, STARTER_TEMPLATES, templateVariables, toE164 } from "./core";

describe("phone numbers", () => {
  it("normalises to E.164", () => {
    expect(toE164("+1 (604) 555-0101")).toBe("+16045550101");
    expect(toE164("604 555 0101")).toBe("+16045550101");
    expect(toE164("1-604-555-0101")).toBe("+16045550101");
    expect(toE164("whatsapp:+447700900123")).toBe("+447700900123");
    expect(toE164("12345")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("inbound", () => {
  it("parses Twilio's WhatsApp and text message webhook fields", () => {
    expect(parseInbound({ MessageSid: "SM1", From: "whatsapp:+16045550101", To: "whatsapp:+16045550199", Body: "Hi!", ProfileName: "Ava", NumMedia: "0" })).toEqual({
      channel: "whatsapp", messageSid: "SM1", from: "+16045550101", to: "+16045550199", body: "Hi!", profileName: "Ava", numMedia: 0,
    });
    expect(parseInbound({ MessageSid: "SM2", From: "+16045550101", To: "+16045550199", Body: "Can I move to 3pm?" })).toMatchObject({ channel: "sms", body: "Can I move to 3pm?" });
    // Delivery status callbacks (no body) are not messages.
    expect(parseInbound({ MessageSid: "SM3", From: "+16045550199", To: "+16045550101", MessageStatus: "delivered" })).toBeNull();
    expect(parseInbound({ From: "whatsapp:+16045550101", To: "whatsapp:+16045550199" })).toBeNull();
  });

  it("knows the 24-hour window", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    expect(inSessionWindow("2026-12-01T00:00:00Z", now)).toBe(true);
    expect(inSessionWindow("2026-11-30T11:59:00Z", now)).toBe(false);
    expect(inSessionWindow(null, now)).toBe(false);
  });

  it("validates Twilio signatures with the SDK", () => {
    const token = "test_auth_token";
    const url = "https://app.example.com/api/webhooks/twilio";
    const params = { MessageSid: "SM1", From: "whatsapp:+16045550101", To: "whatsapp:+16045550199", Body: "Hi" };
    const sig = twilio.getExpectedTwilioSignature(token, url, params);
    expect(twilio.validateRequest(token, sig, url, params)).toBe(true);
    expect(twilio.validateRequest(token, sig, url, { ...params, Body: "Hi!" })).toBe(false);
    expect(twilio.validateRequest("other", sig, url, params)).toBe(false);
  });
});

describe("templates", () => {
  it("fills every starter template's variables", () => {
    for (const [id, t] of Object.entries(STARTER_TEMPLATES)) {
      const vars = templateVariables(id, { name: "Ava", business: "Shop", when: "Tue", reviewLink: "https://r", tracking: "1Z" });
      const needed = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
      for (const n of needed) expect(vars[n], `${id} {{${n}}}`).toBeTruthy();
      expect(Object.keys(t.variables).sort()).toEqual([...new Set(needed)].sort());
    }
  });

  it("maps sender statuses", () => {
    expect(lineStatusFromSender("ONLINE")).toBe("online");
    expect(lineStatusFromSender("PENDING_VERIFICATION")).toBe("registering");
    expect(lineStatusFromSender("OFFLINE")).toBe("offline");
  });
});

describe("resolvePhone", () => {
  it("follows links to the client's phone and normalises it", async () => {
    const { resolvePhone } = await import("./recipient");
    const { demoBlueprint, demoRecords } = await import("@/demo/salon");
    const rows = demoRecords();
    const get = async (t: string, id: string) => rows.find((r) => r.tableId === t && r.id === id)?.data ?? null;
    const avaBooking = rows.find((r) => r.id.endsWith("000000000030"))!;
    expect(await resolvePhone(demoBlueprint, "tbl_bookings", avaBooking.data, "fld_client", get)).toEqual({ phone: "+16045550101", name: "Ava Thompson" });
    const chloe = rows.find((r) => r.id.endsWith("000000000032"))!; // Chloé has no phone
    expect(await resolvePhone(demoBlueprint, "tbl_bookings", chloe.data, "fld_client", get)).toBeNull();
  });
});
