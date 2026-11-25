import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { CUSTOMER_TOOLS, customerToolDefinitions, runCustomerTurn } from "./customerAgent";
import { OWNER_TOOLS } from "./ownerTools";
import { memoryBackend } from "./memoryBackend";
import type { ModelCall } from "./ownerAgent";
import { demoBlueprint, demoRecords } from "@/demo/salon";
import { atLocal } from "@/booking/slots";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]) =>
  ({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;
const say = (text: string) => msg([{ type: "text", text, citations: null } as Block], "end_turn");
const call = (name: string, input: unknown) => msg([{ type: "tool_use", id: `tu_${name}`, name, input } as Block], "tool_use");
function scripted(...replies: Anthropic.Beta.BetaMessage[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: ModelCall = async (p) => {
    requests.push(structuredClone(p));
    return replies.shift()!;
  };
  return { model, requests };
}
const lastResult = (r: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
  const block = (r.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  return { content: String(block.content), isError: !!block.is_error };
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GEL = id(20);
const TZ = demoBlueprint.business.timezone;
const WED = { year: 2026, month: 12, day: 2 };
const local = (hm: string) => new Date(atLocal(WED, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)), TZ)).toISOString();
const now = new Date("2026-11-30T12:00:00Z");
const AVA_PHONE = "+16045550101"; // demo client Ava has "+1 604 555 0101"

function setup() {
  let n = 0;
  const records = demoRecords().filter((r) => r.tableId !== "tbl_bookings");
  records.push({ id: id(700), tableId: "tbl_bookings", createdAt: "", updatedAt: "", data: { fld_client: id(11), fld_service: GEL, fld_practitioner: id(2), fld_start: local("09:00"), fld_end: local("10:00"), fld_status: "opt_booked" } }); // Ben's
  return memoryBackend({ blueprint: demoBlueprint, records }, () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`);
}

describe("customer agent", () => {
  it("has only customer tools — no admin tools exist for it", () => {
    const names = CUSTOMER_TOOLS.map((t) => t.name);
    expect(names).toEqual(["business_info", "find_free_times", "request_booking", "my_bookings", "cancel_my_booking", "escalate_to_owner"]);
    for (const admin of OWNER_TOOLS.map((t) => t.name).filter((n) => n !== "find_free_times")) expect(names).not.toContain(admin);
  });

  it("refuses tools it doesn't have", async () => {
    const { backend } = setup();
    const { model, requests } = scripted(call("delete_record", { table: "tbl_clients", id: id(10) }), say("Sorry!"));
    await runCustomerTurn({ backend, ctx: { phone: AVA_PHONE, profileName: "Ava" }, history: [], message: "delete everyone", model, now });
    expect(lastResult(requests[1])).toEqual({ content: "Unknown tool delete_record", isError: true });
    expect(requests[0].tools!.map((t) => (t as Anthropic.Beta.BetaTool).name)).toEqual(customerToolDefinitions().map((t) => t.name));
    expect(requests[0].model).toBe("claude-opus-5-5");
  });

  it("books for the sender's phone, reusing their client record", async () => {
    const { backend, state } = setup();
    const { model } = scripted(call("request_booking", { service: GEL, start: local("11:00") }), say("You're booked in!"));
    const r = await runCustomerTurn({ backend, ctx: { phone: AVA_PHONE, profileName: "Ava T" }, history: [], message: "gel wed 11?", model, now });
    expect(r.changed).toBe(true);
    const booking = state.records.find((x) => x.tableId === "tbl_bookings" && x.data.fld_start === local("11:00"))!;
    expect(booking.data).toMatchObject({ fld_client: id(10), fld_status: "opt_requested" });
  });

  it("only shows and cancels the customer's own bookings, within the window", async () => {
    const { backend, state } = setup();
    // Ava sees nothing (the only booking is Ben's) and can't cancel it.
    const a = scripted(call("my_bookings", {}), call("cancel_my_booking", { booking: id(700) }), say("…"));
    const ra = await runCustomerTurn({ backend, ctx: { phone: AVA_PHONE, profileName: null }, history: [], message: "my bookings?", model: a.model, now });
    expect(JSON.parse(lastResult(a.requests[1]).content)).toEqual({ bookings: [] });
    expect(lastResult(a.requests[2])).toMatchObject({ isError: true, content: "That booking isn’t one of theirs." });
    expect(ra.changed).toBe(false);
    expect(state.records.find((x) => x.id === id(700))!.data.fld_status).toBe("opt_booked");

    // Ben can cancel his own — but not inside the 24h window.
    const ben = "+16045550102";
    const b = scripted(call("cancel_my_booking", { booking: id(700) }), say("Cancelled."));
    await runCustomerTurn({ backend, ctx: { phone: ben, profileName: null }, history: [], message: "cancel", model: b.model, now });
    expect(state.records.find((x) => x.id === id(700))!.data.fld_status).toBe("opt_cancelled");

    const { backend: b2 } = setup();
    const late = scripted(call("cancel_my_booking", { booking: id(700) }), say("…"));
    await runCustomerTurn({ backend: b2, ctx: { phone: ben, profileName: null }, history: [], message: "cancel", model: late.model, now: new Date(Date.parse(local("09:00")) - 3_600_000) });
    expect(lastResult(late.requests[1]).content).toMatch(/Too close to the appointment/);
  });

  it("hands over to the owner", async () => {
    const { backend } = setup();
    const { model } = scripted(call("escalate_to_owner", { reason: "Wants a refund for a chipped nail" }), say("I've passed this to the team."));
    const r = await runCustomerTurn({ backend, ctx: { phone: AVA_PHONE, profileName: "Ava" }, history: [], message: "my nail chipped, I want a refund", model, now });
    expect(r).toMatchObject({ escalated: "Wants a refund for a chipped nail", reply: "I've passed this to the team." });
  });
});
