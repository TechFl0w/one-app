import { describe, expect, it } from "vitest";
import twilio from "twilio";

/** Captures what the Twilio SDK actually sends, so our request shapes match the API. */
function capture(response: unknown) {
  const seen: { method: string; uri: string; data: unknown; headers: Record<string, string> }[] = [];
  const httpClient = {
    request: async (opts: { method: string; uri: string; data: unknown; headers: Record<string, string> }) => {
      seen.push({ method: opts.method, uri: opts.uri, data: opts.data, headers: opts.headers });
      return { statusCode: 201, body: JSON.stringify(response), headers: {} };
    },
  };
  const client = twilio("ACtest", "token", { httpClient: httpClient as never });
  return { client, seen };
}

describe("Twilio request shapes", () => {
  it("sends WhatsApp messages (free text and templates) as form fields", async () => {
    const { client, seen } = capture({ sid: "SM1", status: "queued" });
    await client.messages.create({ from: "whatsapp:+16045550199", to: "whatsapp:+16045550101", body: "Hi" });
    await client.messages.create({ from: "whatsapp:+16045550199", to: "whatsapp:+16045550101", contentSid: "HX1", contentVariables: JSON.stringify({ "1": "Ava" }) });
    expect(seen[0].uri).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(seen[0].data).toMatchObject({ From: "whatsapp:+16045550199", To: "whatsapp:+16045550101", Body: "Hi" });
    expect(seen[1].data).toMatchObject({ ContentSid: "HX1", ContentVariables: '{"1":"Ava"}' });
  });

  it("creates templates and senders with the API's JSON field names", async () => {
    const { client, seen } = capture({ sid: "HX1" });
    await client.content.v1.contents.create({ friendly_name: "shop_appointment_reminder", language: "en", variables: { "1": "Ava" }, types: { "twilio/text": { body: "Hi {{1}}" } } } as never);
    await client.content.v1.contents("HX1").approvalCreate.create({ name: "shop_appointment_reminder", category: "UTILITY" } as never);
    await client.messaging.v2.channelsSenders.create({ sender_id: "whatsapp:+16045550199", configuration: { waba_id: "123" }, webhook: { callback_url: "https://x/api/webhooks/twilio", callback_method: "POST" }, profile: { name: "Shop" } } as never);
    expect(seen[0].uri).toBe("https://content.twilio.com/v1/Content");
    expect(seen[0].data).toEqual({ friendly_name: "shop_appointment_reminder", language: "en", variables: { "1": "Ava" }, types: { "twilio/text": { body: "Hi {{1}}" } } });
    expect(seen[1].uri).toBe("https://content.twilio.com/v1/Content/HX1/ApprovalRequests/whatsapp");
    expect(seen[2].uri).toBe("https://messaging.twilio.com/v2/Channels/Senders");
    expect(seen[2].data).toMatchObject({ sender_id: "whatsapp:+16045550199", configuration: { waba_id: "123" } });
  });
});
