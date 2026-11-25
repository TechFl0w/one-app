import { describe, expect, it } from "vitest";
import { handleInboundWhatsApp, type Conversation, type InboundDeps } from "./inbound";

const msg = { messageSid: "SM1", from: "+16045550101", to: "+16045550199", body: "Do you have time Friday?", profileName: "Ava", numMedia: 0 };

function fakes(over: Partial<InboundDeps> & { mode?: Conversation["mode"] } = {}) {
  const log: string[] = [];
  const conv: Conversation = { id: "c1", businessId: "b1", customerPhone: msg.from, mode: over.mode ?? "agent", history: [] };
  const seen = new Set<string>();
  const deps: InboundDeps = {
    businessForNumber: async (n) => (n === "+16045550199" ? "b1" : null),
    conversation: async () => conv,
    saveInbound: async (_c, m) => (seen.has(m.messageSid) ? false : (seen.add(m.messageSid), true)),
    agentReply: async () => ({ reply: "Yes, Friday at 2 works!", history: ["h"], escalated: null }),
    send: async (_c, body, author) => void log.push(`send(${author}): ${body}`),
    saveConversation: async (c, p) => {
      Object.assign(c, p);
      log.push(`save: ${JSON.stringify(p)}`);
    },
    notifyOwner: async (_b, text) => void log.push(`notify: ${text}`),
    ...over,
  };
  return { deps, log, conv };
}

describe("inbound WhatsApp", () => {
  it("routes by the business number and lets the agent answer", async () => {
    const { deps, log } = fakes();
    expect(await handleInboundWhatsApp(msg, deps)).toBe("answered");
    expect(log).toEqual(["send(agent): Yes, Friday at 2 works!", 'save: {"history":["h"]}']);
    expect(await handleInboundWhatsApp(msg, deps)).toBe("duplicate");
    expect(await handleInboundWhatsApp({ ...msg, messageSid: "SM2", to: "+19999999999" }, deps)).toBe("ignored");
  });

  it("hands over to the owner when the agent escalates", async () => {
    const { deps, log, conv } = fakes({ agentReply: async () => ({ reply: "I’ve passed this on.", history: [], escalated: "Refund request" }) });
    expect(await handleInboundWhatsApp(msg, deps)).toBe("escalated");
    expect(conv.mode).toBe("owner");
    expect(log.at(-1)).toBe("notify: Ava (+16045550101) needs you on WhatsApp: Refund request");
  });

  it("doesn't run the agent once the owner has taken over", async () => {
    let agentCalled = false;
    const { deps, log } = fakes({ mode: "owner", agentReply: async () => ((agentCalled = true), { reply: "", history: [], escalated: null }) });
    expect(await handleInboundWhatsApp(msg, deps)).toBe("owner_notified");
    expect(agentCalled).toBe(false);
    expect(log).toEqual(["notify: New WhatsApp from Ava (+16045550101): Do you have time Friday?"]);
  });

  it("falls back to the owner if the assistant fails", async () => {
    const { deps, log, conv } = fakes({ agentReply: async () => { throw new Error("model down"); } });
    expect(await handleInboundWhatsApp(msg, deps)).toBe("escalated");
    expect(conv.mode).toBe("owner");
    expect(log[1]).toMatch(/^send\(agent\): Thanks for your message/);
  });
});
