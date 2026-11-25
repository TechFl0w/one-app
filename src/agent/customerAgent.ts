import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Blueprint } from "@/schema/blueprint";
import { RecordId } from "@/schema/records";
import { availableSlots, bookSlot, catalog, schedulingOf } from "@/booking/service";
import { customerCanCancel, optionFor, stateOf } from "@/booking/lifecycle";
import { hoursSummary } from "@/components/blocks/format";
import { toE164 } from "@/whatsapp/core";
import { anthropicModel, type Message, type ModelCall } from "./ownerAgent";
import type { OwnerBackend } from "./types";

/**
 * The customer agent (WhatsApp). Separated from the owner agent by code, not by prompt
 * (CLAUDE.md rule 5): it has its own small tool list, no admin tools exist here, and the
 * customer's identity (their phone number) comes from the channel, never from the model.
 * Every tool is scoped to that customer.
 */

export const CUSTOMER_MODEL = "claude-opus-5-5";
const MAX_STEPS = 6;

type Backend = Pick<OwnerBackend, "blueprint" | "query" | "createRecord" | "updateRecord">;

export interface CustomerContext {
  /** E.164, decided by the webhook from the sender — the model can't change it. */
  phone: string;
  profileName: string | null;
}

interface Effects {
  escalated?: string;
  booked?: boolean;
}

interface CustomerTool<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  run(b: Backend, bp: Blueprint, ctx: CustomerContext, input: I, fx: Effects, now: Date): Promise<unknown>;
}
const tool = <I>(t: CustomerTool<I>) => t as unknown as CustomerTool<unknown>;

/** This customer's client record id (matched on their phone), if any. */
async function myClientId(b: Backend, bp: Blueprint, ctx: CustomerContext): Promise<string | null> {
  const sc = schedulingOf(bp);
  if (!sc.clients.phone) return null;
  const { records } = await b.query({ table: sc.clients.table, limit: 500 });
  return records.find((r) => toE164(String(r.data[sc.clients.phone!] ?? "")) === ctx.phone)?.id ?? null;
}

async function myBookings(b: Backend, bp: Blueprint, ctx: CustomerContext, now: Date) {
  const sc = schedulingOf(bp);
  const clientId = await myClientId(b, bp, ctx);
  if (!clientId) return [];
  const { records } = await b.query({
    table: sc.bookings.table,
    filters: [
      { field: sc.bookings.client, op: "eq", value: clientId },
      { field: sc.bookings.start, op: "gte", value: now.toISOString() },
    ],
    sort: [{ field: sc.bookings.start, dir: "asc" }],
    limit: 20,
  });
  return records.filter((r) => !["cancelled", "no_show"].includes(stateOf(sc, r.data[sc.bookings.status])));
}

export const CUSTOMER_TOOLS: CustomerTool<unknown>[] = [
  tool({
    name: "business_info",
    description: "The business's services (with duration and price), team members who take bookings, and opening hours.",
    input: z.strictObject({}),
    run: async (b, bp) => {
      const c = await catalog(bp, b);
      return { business: c.business, timezone: c.timezone, services: c.services, team: c.practitioners, hours: bp.scheduling ? hoursSummary(bp.scheduling.hours as Record<string, [string, string][]>) : null };
    },
  }),
  tool({
    name: "find_free_times",
    description: "Free appointment times for a service (optionally with one team member) from a date (YYYY-MM-DD, business timezone), up to 7 days.",
    input: z.strictObject({ service: RecordId, practitioner: RecordId.optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days: z.int().min(1).max(7).optional() }),
    run: async (b, bp, _ctx, i, _fx, now) => {
      const [y, m, d] = i.date.split("-").map(Number);
      const slots = await availableSlots(bp, b, { serviceId: i.service, practitionerId: i.practitioner, from: { year: y, month: m, day: d }, days: i.days ?? 1 }, now);
      return { timezone: bp.business.timezone, count: slots.length, slots: slots.slice(0, 20) };
    },
  }),
  tool({
    name: "request_booking",
    description: "Book a free time for this customer (use find_free_times first, and confirm the details with them before calling).",
    input: z.strictObject({ service: RecordId, start: z.string(), practitioner: RecordId.optional(), name: z.string().min(1).max(100).optional() }),
    run: async (b, bp, ctx, i, fx, now) => {
      const r = await bookSlot(bp, b, { serviceId: i.service, practitionerId: i.practitioner, start: i.start, client: { name: i.name ?? ctx.profileName ?? "WhatsApp customer", phone: ctx.phone } }, now);
      fx.booked = true;
      return { booked: { start: r.slot.start, status: r.state === "confirmed" ? "confirmed" : "requested — the business will confirm" } };
    },
  }),
  tool({
    name: "my_bookings",
    description: "This customer's upcoming bookings.",
    input: z.strictObject({}),
    run: async (b, bp, ctx, _i, _fx, now) => {
      const sc = schedulingOf(bp);
      return { bookings: (await myBookings(b, bp, ctx, now)).map((r) => ({ id: r.id, start: r.data[sc.bookings.start], service: r.data[sc.bookings.service], status: stateOf(sc, r.data[sc.bookings.status]) })) };
    },
  }),
  tool({
    name: "cancel_my_booking",
    description: "Cancel one of this customer's own upcoming bookings (only allowed until the cancellation window).",
    input: z.strictObject({ booking: RecordId }),
    run: async (b, bp, ctx, i, fx, now) => {
      const sc = schedulingOf(bp);
      const mine = (await myBookings(b, bp, ctx, now)).find((r) => r.id === i.booking);
      if (!mine) throw new Error("That booking isn’t one of theirs.");
      if (!customerCanCancel(String(mine.data[sc.bookings.start]), now, sc.rules.cancelWindowHours)) {
        throw new Error(`Too close to the appointment to cancel here (less than ${sc.rules.cancelWindowHours} hours). Offer to pass a message to the business.`);
      }
      await b.updateRecord(sc.bookings.table, mine.id, { [sc.bookings.status]: optionFor(sc, "cancelled") });
      fx.booked = true;
      return { cancelled: mine.id };
    },
  }),
  tool({
    name: "escalate_to_owner",
    description: "Hand the conversation to the business owner: complaints, refunds, special requests, anything you can't answer or do with your tools.",
    input: z.strictObject({ reason: z.string().min(1).max(300) }),
    run: async (_b, _bp, _ctx, i, fx) => {
      fx.escalated = i.reason;
      return { handed_over: true };
    },
  }),
];

export const customerToolDefinitions = (): Anthropic.Beta.BetaTool[] =>
  CUSTOMER_TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.BetaTool["input_schema"] };
  });

export function customerSystem(bp: Blueprint, now: Date): string {
  return `You answer WhatsApp messages from customers of ${bp.business.name}, on behalf of the business. Today is ${now.toISOString().slice(0, 10)} (times are in ${bp.business.timezone}).

You can: answer questions about services, prices and opening hours; find free times; book appointments; show and cancel the customer's own bookings. Use the tools for facts — never guess prices or availability.

Rules:
- Only help with this business. You can't change prices, give discounts, refund, or see other customers' information.
- Before booking, confirm the service, day and time with the customer in one short message.
- For complaints, refunds, special requests or anything you can't do, use escalate_to_owner and tell the customer someone from the business will reply here.
- Write like a friendly receptionist on WhatsApp: short messages, no markdown headings, no IDs.`;
}

export interface CustomerTurnResult {
  reply: string;
  history: Message[];
  escalated: string | null;
  changed: boolean;
}

/** One customer message in, one reply out (plus whether the owner should take over). */
export async function runCustomerTurn(input: {
  backend: Backend;
  ctx: CustomerContext;
  history: Message[];
  message: string;
  model?: ModelCall;
  now?: Date;
}): Promise<CustomerTurnResult> {
  const { backend, ctx, model = anthropicModel(), now = new Date() } = input;
  const bp = await backend.blueprint();
  const messages: Message[] = [...input.history, { role: "user", content: input.message }];
  const fx: Effects = {};
  let reply = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await model({
      model: CUSTOMER_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: customerSystem(bp, now), cache_control: { type: "ephemeral" } }],
      tools: customerToolDefinitions(),
      messages,
    });
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "refusal") {
      reply = "Sorry, I can’t help with that here. Someone from the business will get back to you.";
      fx.escalated ??= "The assistant couldn’t answer this message";
      break;
    }
    const calls = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      reply = res.content.filter((c): c is Anthropic.Beta.BetaTextBlock => c.type === "text").map((c) => c.text).join("\n").trim();
      break;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const t = CUSTOMER_TOOLS.find((x) => x.name === call.name);
      const parsed = t?.input.safeParse(call.input);
      let content: string;
      let isError = false;
      if (!t || !parsed?.success) {
        content = t ? `Invalid input: ${parsed!.error!.issues[0]?.message}` : `Unknown tool ${call.name}`;
        isError = true;
      } else {
        try {
          content = JSON.stringify(await t.run(backend, bp, ctx, parsed.data, fx, now)).slice(0, 8000);
        } catch (e) {
          content = e instanceof Error ? e.message : String(e);
          isError = true;
        }
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }

  if (!reply) reply = fx.escalated ? "Thanks — I’ve passed this to the team and someone will reply here soon." : "Sorry, could you say that another way?";
  return { reply, history: messages, escalated: fx.escalated ?? null, changed: !!fx.booked };
}
