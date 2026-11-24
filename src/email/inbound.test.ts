import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { forwardedCopy, handleReceived, verifyWebhook, type InboundDeps, type InboxRow } from "./inbound";
import { emailDomains, type EmailSettings } from "./compose";

const d = emailDomains({});
const SECRET = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const settings: EmailSettings = { businessId: "b1", slug: "glass-co", fromName: "Glass Co", replyMode: "inbound", ownerEmail: "owner@gmail.com", forwardToOwner: true };

function deps(overrides: Partial<InboundDeps> = {}) {
  const stored: InboxRow[] = [];
  const forwarded: InboxRow[] = [];
  const d: InboundDeps = {
    settingsBySlug: async (slug) => (slug === "glass-co" ? settings : null),
    fetchEmail: async () => ({ from: "Ava <ava@example.com>", to: ["glass-co@in.buildingwaves.tech"], subject: "Order question", text: "Is it in stock?", html: "<p>Is it in stock?</p>", created_at: "2026-11-24T10:00:00Z" }),
    saveInbox: async (row) => {
      if (stored.some((s) => s.providerId === row.providerId)) return false;
      stored.push(row);
      return true;
    },
    forwardToOwner: async (_s, row) => {
      forwarded.push(row);
    },
    ...overrides,
  };
  return { d, stored, forwarded };
}

const event = { email_id: "em_1", created_at: "2026-11-24T10:00:00Z", from: "ava@example.com", to: ["glass-co@in.buildingwaves.tech"], subject: "Order question" };

describe("inbound email", () => {
  it("stores the full message in the right business and forwards it once", async () => {
    const { d: deps1, stored, forwarded } = deps();
    expect(await handleReceived(event, deps1, d)).toEqual({ status: "stored", businessId: "b1", forwarded: true });
    expect(stored[0]).toMatchObject({ businessId: "b1", fromAddress: "ava@example.com", fromName: "Ava", text: "Is it in stock?" });
    expect(await handleReceived(event, deps1, d)).toEqual({ status: "duplicate", businessId: "b1", forwarded: false });
    expect(forwarded).toHaveLength(1);
  });

  it("ignores mail for unknown addresses and doesn't forward the owner's own mail", async () => {
    const { d: deps1 } = deps();
    expect(await handleReceived({ ...event, to: ["nobody@in.buildingwaves.tech"] }, deps1, d)).toMatchObject({ status: "ignored" });
    expect(await handleReceived({ ...event, to: ["glass-co@elsewhere.com"] }, deps1, d)).toMatchObject({ status: "ignored" });
    const { d: deps2, forwarded } = deps({ fetchEmail: async () => ({ from: "owner@gmail.com", to: [], subject: null, text: "x", html: null, created_at: "2026-11-24T10:00:00Z" }) });
    expect(await handleReceived(event, deps2, d)).toMatchObject({ status: "stored", forwarded: false });
    expect(forwarded).toHaveLength(0);
  });

  it("builds a forward that replies straight to the customer", () => {
    const f = forwardedCopy({ businessId: "b1", providerId: "em_1", fromAddress: "ava@example.com", fromName: "Ava", toAddresses: [], subject: "Hi", text: "Hello", html: null, receivedAt: "" });
    expect(f).toMatchObject({ subject: "Fwd: Hi", replyTo: "ava@example.com" });
    expect(f.text).toContain("From: Ava <ava@example.com>");
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ type: "email.received", data: event });
  const signed = (id: string, at: Date, payload = body) => {
    const sig = new Webhook(SECRET).sign(id, at, payload);
    return new Headers({ "svix-id": id, "svix-timestamp": String(Math.floor(at.getTime() / 1000)), "svix-signature": sig });
  };

  it("accepts a valid signature (svix-* or webhook-* headers)", () => {
    expect(verifyWebhook(body, signed("msg_1", new Date()), SECRET)).toMatchObject({ type: "email.received" });
    const h = signed("msg_2", new Date());
    const alt = new Headers({ "webhook-id": h.get("svix-id")!, "webhook-timestamp": h.get("svix-timestamp")!, "webhook-signature": h.get("svix-signature")! });
    expect(() => verifyWebhook(body, alt, SECRET)).not.toThrow();
  });

  it("rejects tampered, unsigned and stale requests", () => {
    expect(() => verifyWebhook(body.replace("Order", "Odder"), signed("msg_1", new Date()), SECRET)).toThrow();
    expect(() => verifyWebhook(body, new Headers(), SECRET)).toThrow();
    expect(() => verifyWebhook(body, signed("msg_1", new Date(Date.now() - 60 * 60_000)), SECRET)).toThrow();
  });
});
