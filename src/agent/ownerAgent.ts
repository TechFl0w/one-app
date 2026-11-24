import Anthropic from "@anthropic-ai/sdk";
import type { Blueprint } from "@/schema/blueprint";
import { menuOrder } from "@/engine/editing";
import { localToday, isoDate } from "@/engine/dates";
import { OWNER_TOOLS, ownerTool, ownerToolDefinitions, type ToolEffects } from "./ownerTools";
import type { AgentResponse, OwnerBackend, PendingAction } from "./types";

/**
 * The owner agent: a manual tool-use loop over OWNER_TOOLS. Who is talking is decided by the
 * caller before this runs (CLAUDE.md rule 5); this agent only ever gets owner tools.
 */

export const OWNER_MODEL = "claude-opus-5-5";
const MAX_STEPS = 10;
const MAX_RESULT_CHARS = 12_000;

export type Message = Anthropic.Beta.BetaMessageParam;
export type ModelCall = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

/** Default model call: Opus 5.5 with server-side refusal fallback. */
export function anthropicModel(client = new Anthropic()): ModelCall {
  return (params) => client.beta.messages.create(params);
}

export const OWNER_SYSTEM = `You are the assistant inside One App, a business-management app for a small business. You talk with the owner.

You can read and change their data (records) and their setup (tables, fields, pages, blocks, automations) with your tools. Everything you change shows up in their app right away.

How to work:
- Use the setup summary below for ids. Refer to things by their labels when you talk to the owner; never show ids, JSON or tool names.
- Prefer doing over explaining: when the owner asks for a change, make it, then say in one or two sentences what changed.
- Setup changes go through change_setup in one call per request. Keep labels short and in the owner's language.
- Removing data, changing prices or amounts, and changing automations wait for the owner's confirmation. When a tool tells you it is waiting, say plainly what will happen and that they can confirm below. Never claim it is done.
- If a request is unclear, ask one short question with concrete options.
- Keep replies short and warm. Plain sentences; a short list only when listing records.`;

/** Compact, id-annotated summary of the setup for the model. */
export function setupSummary(bp: Blueprint, now = new Date()): string {
  const lines: string[] = [];
  lines.push(`Business: ${bp.business.name} (${bp.business.type}), timezone ${bp.business.timezone}, today is ${isoDate(localToday(now, bp.business.timezone))}.`);
  lines.push("", "Tables:");
  for (const t of bp.tables) {
    lines.push(`- ${t.id} "${t.label}"${t.primaryField ? ` (title field ${t.primaryField})` : ""}`);
    for (const f of t.fields) {
      let extra = "";
      if (f.type === "status" || f.type === "choice") extra = ` options: ${f.options.map((o) => `${o.id}="${o.label}"`).join(", ")}${f.multiple ? " (multiple)" : ""}`;
      if (f.type === "link") extra = ` → ${f.to}${f.multiple ? " (multiple)" : ""}`;
      if (f.type === "money" && f.currency) extra = ` ${f.currency}`;
      lines.push(`    ${f.id} "${f.label}" ${f.type}${f.required ? " required" : ""}${extra}`);
    }
  }
  lines.push("", "Pages (menu order):");
  for (const p of menuOrder(bp)) {
    lines.push(`- ${p.id} "${p.label}"${p.hidden ? " (hidden)" : ""}`);
    for (const b of p.layout.blocks) {
      const title = typeof b.options?.title === "string" ? ` "${b.options.title}"` : "";
      lines.push(`    ${b.id} ${b.type}${title}${b.source ? ` from ${b.source.table}` : ""} at x${b.x} y${b.y} w${b.w} h${b.h}`);
    }
    const overrides = Object.keys(p.layoutOverrides ?? {});
    if (overrides.length) lines.push(`    separate layouts: ${overrides.join(", ")}`);
  }
  if (bp.automations.length) {
    lines.push("", "Automations:");
    for (const a of bp.automations) lines.push(`- ${a.id} "${a.label}" ${a.enabled ? "on" : "off"}, trigger ${a.trigger.type}${a.trigger.table ? ` on ${a.trigger.table}` : ""}`);
  }
  lines.push("", "The grid has 12 columns; blocks have x, y, w (width in columns) and h (height in rows).");
  return lines.join("\n");
}

export interface OwnerTurnInput {
  backend: OwnerBackend;
  /** Earlier messages of this owner's conversation (as returned by previous turns). */
  history: Message[];
  message: string;
  /** Page the owner is looking at, so "make this bigger" works. */
  pageId?: string;
  model?: ModelCall;
  now?: Date;
  newId?: () => string;
}

export interface OwnerTurnResult {
  /** Full conversation to store for the next turn. */
  history: Message[];
  response: AgentResponse;
  /** Risky actions to store server-side until the owner confirms or cancels. */
  pending: PendingAction[];
}

export async function runOwnerTurn(input: OwnerTurnInput): Promise<OwnerTurnResult> {
  const { backend, model = anthropicModel(), now = new Date(), newId = () => crypto.randomUUID() } = input;
  const bp = await backend.blueprint();
  const page = input.pageId ? bp.pages.find((p) => p.id === input.pageId) : undefined;
  const userText = page ? `[The owner is looking at page "${page.label}" (${page.id}).]\n\n${input.message}` : input.message;
  const messages: Message[] = [...input.history, { role: "user", content: userText }];

  const effects: ToolEffects = {};
  const pending: PendingAction[] = [];
  let text = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const current = await backend.blueprint();
    const response = await model({
      model: OWNER_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: OWNER_SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: `Current setup:\n${setupSummary(current, now)}` },
      ],
      tools: ownerToolDefinitions(),
      messages,
    });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      text = "I can’t help with that one.";
      break;
    }
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) {
      text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "max_tokens" && !text) text = "That got too long — could you ask in smaller steps?";
      break;
    }

    // All results go back in one user message (keeps parallel tool use working).
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) results.push(await runTool(call, backend, effects, pending, newId));
    messages.push({ role: "user", content: results });
  }

  if (!text) text = pending.length ? "Please confirm below." : "Done.";

  const response: AgentResponse = { text, changed: !!effects.changed };
  if (effects.preview) {
    response.preview = effects.preview;
    response.buttons = [
      { label: "Keep", action: "keep" },
      { label: "Undo", action: "undo" },
    ];
  }
  if (pending.length) {
    response.confirm = { items: pending.flatMap((p) => p.items), actionIds: pending.map((p) => p.id) };
    response.buttons = [
      { label: "Confirm", action: "confirm" },
      { label: "Cancel", action: "cancel" },
    ];
  }
  return { history: messages, response, pending };
}

async function runTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  backend: OwnerBackend,
  effects: ToolEffects,
  pending: PendingAction[],
  newId: () => string,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const result = (content: unknown, isError = false): Anthropic.Beta.BetaToolResultBlockParam => {
    let s = typeof content === "string" ? content : JSON.stringify(content);
    if (s.length > MAX_RESULT_CHARS) s = `${s.slice(0, MAX_RESULT_CHARS)}… (truncated; ask for fewer rows)`;
    return { type: "tool_result", tool_use_id: call.id, content: s, ...(isError ? { is_error: true } : {}) };
  };

  const t = ownerTool(call.name);
  if (!t) return result(`Unknown tool ${call.name}`, true);
  const parsed = t.input.safeParse(call.input);
  if (!parsed.success) {
    return result(`Invalid input: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, true);
  }
  try {
    const bp = await backend.blueprint();
    const risk = typeof t.risk === "function" ? t.risk(parsed.data, bp) : t.risk;
    if (risk === "risky") {
      const action: PendingAction = { id: newId(), tool: t.name, input: parsed.data, items: t.describe?.(parsed.data, bp) ?? [call.name] };
      pending.push(action);
      return result({ status: "waiting_for_owner_confirmation", will_do: action.items });
    }
    return result(await t.run(backend, parsed.data, effects, { confirmed: false }));
  } catch (e) {
    return result(e instanceof Error ? e.message : String(e), true);
  }
}

/**
 * Runs a confirmed PendingAction. Called by app code when the owner presses Confirm, never by
 * the model. Returns effects for the UI and a note to append to the conversation.
 */
export async function runConfirmedAction(backend: OwnerBackend, action: PendingAction): Promise<{ effects: ToolEffects; note: string }> {
  const t = OWNER_TOOLS.find((x) => x.name === action.tool);
  if (!t) throw new Error(`Unknown tool ${action.tool}`);
  const input = t.input.parse(action.input);
  const effects: ToolEffects = {};
  try {
    await t.run(backend, input, effects, { confirmed: true });
    return { effects, note: `[The owner confirmed and it is done: ${action.items.join("; ")}]` };
  } catch (e) {
    return { effects, note: `[The owner confirmed, but it failed: ${e instanceof Error ? e.message : String(e)}]` };
  }
}
