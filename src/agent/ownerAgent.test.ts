import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runConfirmedAction, runOwnerTurn, setupSummary, type ModelCall } from "./ownerAgent";
import { ownerToolDefinitions } from "./ownerTools";
import { memoryBackend } from "./memoryBackend";
import { demoBlueprint, demoRecords } from "@/demo/salon";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]) =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;
const say = (text: string) => msg([{ type: "text", text, citations: null } as Block], "end_turn");
const call = (name: string, input: unknown, id = `tu_${name}`) => msg([{ type: "tool_use", id, name, input } as Block], "tool_use");

/** A model that replays scripted replies and records every request. */
function scripted(...replies: Anthropic.Beta.BetaMessage[]) {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: ModelCall = async (params) => {
    requests.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("model called more often than scripted");
    return next;
  };
  return { model, requests };
}

const lastToolResult = (req: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
  const last = req.messages.at(-1)!;
  const block = (last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  return { content: String(block.content), isError: !!block.is_error };
};

const setup = () => memoryBackend({ blueprint: demoBlueprint, records: demoRecords() }, (() => { let n = 0; return () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`; })());
const ids = { ava: "00000000-0000-4000-8000-000000000010", booking: "00000000-0000-4000-8000-000000000031" };

describe("owner agent", () => {
  it("sends the right request: model, fallbacks, cached system prompt, setup summary, tools, page context", async () => {
    const { backend } = setup();
    const { model, requests } = scripted(say("Hi!"));
    const r = await runOwnerTurn({ backend, history: [], message: "make this bigger", pageId: "pg_today", model });
    const req = requests[0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.output_config).toEqual({ effort: "medium" });
    const system = req.system as Anthropic.Beta.BetaTextBlockParam[];
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[1].text).toContain('blk_cal calendar "Today’s calendar" from tbl_bookings');
    expect(req.tools!.map((t) => (t as Anthropic.Beta.BetaTool).name)).toEqual([
      "query_records", "get_record", "create_record", "update_record", "delete_record", "change_setup", "write_component", "plan_build", "read_component", "write_function", "read_function", "list_api_keys", "test_function", "find_free_times", "book_appointment", "create_payment_link", "list_payments", "refund_payment", "explain_automation",
    ]);
    expect(req.messages[0].content).toContain('looking at page "Today" (pg_today)');
    expect(r.response).toEqual({ text: "Hi!", changed: false });
    expect(r.history).toHaveLength(2);
  });

  it("runs read tools and feeds results back", async () => {
    const { backend } = setup();
    const { model, requests } = scripted(
      call("query_records", { table: "tbl_clients", filters: [{ field: "fld_vip", op: "eq", value: true }] }),
      say("You have 2 VIP clients: Ava and Elena."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "who are my VIPs?", model });
    const res = lastToolResult(requests[1]);
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content).total).toBe(2);
    expect(r.response.text).toBe("You have 2 VIP clients: Ava and Elena.");
  });

  it("applies safe setup changes immediately with Keep/Undo", async () => {
    const { backend, state } = setup();
    const { model } = scripted(
      call("change_setup", { summary: "Rename Clients to Guests", ops: [{ op: "rename", target: { kind: "page", pageId: "pg_clients" }, label: "Guests" }] }),
      say("Done — the Clients page is now called Guests."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "call clients guests", model });
    expect(state.blueprint.pages.find((p) => p.id === "pg_clients")!.label).toBe("Guests");
    expect(r.response.changed).toBe(true);
    expect(r.response.preview?.ops).toEqual([{ op: "rename", risk: "safe", description: "Rename page “Clients” to “Guests”" }]);
    expect(r.response.buttons?.map((b) => b.action)).toEqual(["keep", "undo"]);
    expect(r.pending).toEqual([]);
  });

  it("holds risky actions for confirmation and runs them only when confirmed", async () => {
    const { backend, state } = setup();
    const { model, requests } = scripted(
      call("delete_record", { table: "tbl_clients", id: ids.ava }),
      say("I’ll delete Ava Thompson once you confirm."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "delete ava", model, newId: () => "act_1" });
    expect(JSON.parse(lastToolResult(requests[1]).content).status).toBe("waiting_for_owner_confirmation");
    expect(state.records.some((x) => x.id === ids.ava)).toBe(true); // not deleted yet
    expect(r.pending).toEqual([{ id: "act_1", tool: "delete_record", input: { table: "tbl_clients", id: ids.ava }, items: ["Delete a record from Clients (00000000)"] }]);
    expect(r.response.confirm).toEqual({ items: ["Delete a record from Clients (00000000)"], actionIds: ["act_1"] });
    expect(r.response.buttons?.map((b) => b.action)).toEqual(["confirm", "cancel"]);

    const done = await runConfirmedAction(backend, r.pending[0]);
    expect(done.effects.changed).toBe(true);
    expect(state.records.some((x) => x.id === ids.ava)).toBe(false);
  });

  it("treats price changes as risky but other edits as safe", async () => {
    const { backend, state } = setup();
    const { model } = scripted(
      msg(
        [
          { type: "tool_use", id: "a", name: "update_record", input: { table: "tbl_bookings", id: ids.booking, values: { fld_amount: 60 } } } as Block,
          { type: "tool_use", id: "b", name: "update_record", input: { table: "tbl_bookings", id: ids.booking, values: { fld_notes: "Prefers almond shape" } } } as Block,
        ],
        "tool_use",
      ),
      say("Noted the shape; the price change needs your OK."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "...", model });
    const booking = state.records.find((x) => x.id === ids.booking)!;
    expect(booking.data.fld_notes).toBe("Prefers almond shape");
    expect(booking.data.fld_amount).toBe(48);
    expect(r.pending.map((p) => p.tool)).toEqual(["update_record"]);

    await runConfirmedAction(backend, r.pending[0]);
    expect(state.records.find((x) => x.id === ids.booking)!.data.fld_amount).toBe(60);
    await expect(backend.updateRecord("tbl_bookings", ids.booking, { fld_amount: 1 })).rejects.toThrow(/needs confirmation/);
  });

  it("treats setup changes that remove data or touch automations as risky", async () => {
    const { backend, state } = setup();
    const { model } = scripted(
      call("change_setup", { summary: "Pause reminders", ops: [{ op: "toggleAutomation", automationId: "aut_reminder", enabled: false }] }),
      say("Confirm below to pause the reminder."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "stop reminders", model });
    expect(state.blueprint.automations[0].enabled).toBe(true);
    expect(r.response.confirm?.items).toEqual(["Turn off automation “Reminder 24h before”"]);
    await runConfirmedAction(backend, r.pending[0]);
    expect(state.blueprint.automations[0].enabled).toBe(false);
  });

  it("returns validation problems to the model as tool errors", async () => {
    const { backend } = setup();
    const { model, requests } = scripted(
      call("create_record", { table: "tbl_clients", values: { fld_email: "not an email" } }),
      call("change_setup", { summary: "x", ops: [{ op: "dropDatabase" }] }),
      call("nope", {}),
      say("Sorry — I need a name for the client."),
    );
    await runOwnerTurn({ backend, history: [], message: "add a client", model });
    expect(lastToolResult(requests[1])).toMatchObject({ isError: true, content: expect.stringContaining("Name is required") });
    expect(lastToolResult(requests[2])).toMatchObject({ isError: true, content: expect.stringContaining("Invalid input") });
    expect(lastToolResult(requests[3])).toMatchObject({ isError: true, content: "Unknown tool nope" });
  });

  it("handles refusals and stops runaway loops", async () => {
    const { backend } = setup();
    const refused = await runOwnerTurn({ backend, history: [], message: "x", model: scripted(msg([], "refusal")).model });
    expect(refused.response.text).toBe("I can’t help with that one.");

    const forever: ModelCall = async () => call("query_records", { table: "tbl_team" });
    const looped = await runOwnerTurn({ backend, history: [], message: "x", model: forever });
    expect(looped.history.length).toBe(1 + 16 * 2);
    expect(looped.response.text).toBe("Done.");
  });
});

describe("tool definitions and setup summary", () => {
  it("generates JSON schemas for every tool", () => {
    for (const t of ownerToolDefinitions()) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
    const changeSetup = ownerToolDefinitions().find((t) => t.name === "change_setup")!;
    expect(JSON.stringify(changeSetup.input_schema)).toContain("addField");
  });

  it("summarizes the setup with ids, options and links", () => {
    const s = setupSummary(demoBlueprint, new Date("2026-11-24T20:00:00Z"));
    expect(s).toContain("today is 2026-11-24");
    expect(s).toContain('fld_status "Status" status options: opt_requested="Requested"');
    expect(s).toContain('fld_client "Client" link required → tbl_clients');
    expect(s).toContain('pg_settings "Settings" (hidden)');
  });
});

describe("booking tools", () => {
  it("finds free times and books one", async () => {
    const { backend, state } = setup();
    const { model, requests } = scripted(
      call("find_free_times", { service: "00000000-0000-4000-8000-000000000020", practitioner: "00000000-0000-4000-8000-000000000002", date: "2026-12-02" }),
      say("Priya is free from 9."),
    );
    await runOwnerTurn({ backend, history: [], message: "when is priya free wed", model, now: new Date("2026-11-30T12:00:00Z") });
    const free = JSON.parse(lastToolResult(requests[1]).content);
    expect(free.count).toBeGreaterThan(10);

    const { model: m2 } = scripted(
      call("book_appointment", { service: "00000000-0000-4000-8000-000000000020", start: free.slots[0].start, practitioner: "00000000-0000-4000-8000-000000000002", client: { name: "Zoe", email: "zoe@example.com" } }),
      say("Booked."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "book zoe", model: m2 });
    expect(r.response.changed).toBe(true);
    expect(state.records.some((x) => x.tableId === "tbl_bookings" && x.data.fld_start === free.slots[0].start)).toBe(true);
  });
});

describe("writing custom components", () => {
  const good = `import { Collapsible, RecordForm } from "@one/kit";\nexport default function Hub() {\n  return <Collapsible title="New booking"><RecordForm table="tbl_bookings" /></Collapsible>;\n}`;
  const bad = `import { Collapsible } from "@one/kit";\nexport default function Hub() {\n  return <Collapsible>oops</Collapsible>;\n}`;

  it("sends compile errors back, then places the fixed component over the replaced blocks", async () => {
    const { backend, state } = setup();
    const page = state.blueprint.pages.find((p) => p.id === "pg_bookings")!;
    const replaced = page.layout.blocks.map((b) => b.id);
    const input = (source: string) => ({ id: "cmp_booking_hub", label: "Bookings hub", source, summary: "Collapsible new-booking form above the board", page: "pg_bookings", replaceBlocks: replaced.slice(0, 1), position: { x: 0, y: 0, w: 12, h: 4 } });
    const { model, requests } = scripted(call("write_component", input(bad), "t1"), call("write_component", input(good), "t2"), say("Done."));
    const r = await runOwnerTurn({ backend, history: [], message: "make the new booking form collapsible with a chevron", model });

    const first = lastToolResult(requests[1]);
    expect(first.isError).toBe(true);
    expect(first.content).toMatch(/didn't compile[\s\S]*Line 3:.*title/);
    expect(JSON.parse(lastToolResult(requests[2]).content).component).toBe("cmp_booking_hub");

    expect(state.blueprint.components?.[0]).toMatchObject({ id: "cmp_booking_hub", source: good });
    expect(state.blueprint.components?.[0].compiled).toContain("require(\"@one/kit\")");
    const blocks = state.blueprint.pages.find((p) => p.id === "pg_bookings")!.layout.blocks;
    expect(blocks.map((b) => b.id)).not.toContain(replaced[0]);
    expect(blocks.find((b) => b.type === "custom")).toMatchObject({ id: "blk_booking_hub", options: { component: "cmp_booking_hub" } });
    expect(r.response.buttons?.map((b) => b.action)).toEqual(["keep", "undo"]);
    expect(setupSummary(state.blueprint)).toContain('cmp_booking_hub "Bookings hub"');
  });
});

describe("writing server code", () => {
  const good = `import { records, secret, type RunContext } from "@one/server";\nexport default async function run(ctx: RunContext) {\n  const res = await fetch("https://api.goshippo.com/shipments/", { headers: { Authorization: secret("SHIPPO") } });\n  if (ctx.record) await records.update(ctx.record.table, ctx.record.id, { fld_notes: String(res.status) });\n  return res.status;\n}`;
  const bad = `import { records } from "@one/server";\nexport default async function run() { return records.nope(); }`;

  it("fixes compile errors first, then waits for confirmation before saving", async () => {
    const { backend, state } = setup();
    const input = (source: string) => ({ id: "fn_shippo", label: "Create shipping labels", source, hosts: ["api.goshippo.com"] });
    const { model, requests } = scripted(call("write_function", input(bad), "t1"), call("write_function", input(good), "t2"), say("I’ll save it once you confirm."));
    const r = await runOwnerTurn({ backend, history: [], message: "connect shippo", model, newId: () => "act_fn" });
    expect(lastToolResult(requests[1])).toMatchObject({ isError: true });
    expect(lastToolResult(requests[1]).content).toMatch(/didn't compile[\s\S]*nope/);
    expect(JSON.parse(lastToolResult(requests[2]).content).status).toBe("waiting_for_owner_confirmation");
    expect(state.blueprint.functions).toBeUndefined();
    expect(r.pending[0].items).toEqual(["Add server code “Create shipping labels” that can reach api.goshippo.com"]);

    const done = await runConfirmedAction(backend, r.pending[0]);
    expect(done.ok).toBe(true);
    expect(state.blueprint.functions?.[0]).toMatchObject({ id: "fn_shippo", hosts: ["api.goshippo.com"], source: good });
    expect(setupSummary(state.blueprint)).toContain('fn_shippo "Create shipping labels" hosts: api.goshippo.com');
  });
});

describe("designs in the chat", () => {
  it("sends attached images to the model, applies a theme, and keeps images out of stored history", async () => {
    const { withoutImages } = await import("./ownerAgent");
    const { backend, state } = setup();
    const { model, requests } = scripted(
      call("change_setup", { summary: "Match the design's colours and font", ops: [{ op: "setTheme", theme: { colors: { accent: "#B5482B", ground: "#FBF7F2" }, font: "DM Sans", radius: 8 } }] }),
      say("Matched the colours and font."),
    );
    const r = await runOwnerTurn({ backend, history: [], message: "make it look like this", images: [{ mediaType: "image/jpeg", data: "QUJD" }], model });
    const first = requests[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(first[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(state.blueprint.theme).toEqual({ colors: { accent: "#B5482B", ground: "#FBF7F2" }, font: "DM Sans", radius: 8 });
    expect(r.response.preview?.ops[0].description).toBe("Change the look (colours, fonts, shape)");
    const stored = JSON.stringify(withoutImages(r.history));
    expect(stored).not.toContain("QUJD");
    expect(stored).toContain("[The owner attached an image here.]");
  });

  it("rejects odd attachments", async () => {
    const { cleanImages } = await import("./ownerAgent");
    expect(cleanImages([{ mediaType: "image/gif", data: "QUJD" }, { mediaType: "image/png", data: "not base64!" }, { mediaType: "image/png", data: "QUJD" }, 5])).toEqual([{ mediaType: "image/png", data: "QUJD" }]);
  });
});

describe("multi-step builds", () => {
  it("returns the plan so the chat can continue it", async () => {
    const { backend } = setup();
    const plan = { goal: "Recreate the app", steps: [{ id: "a", title: "Dashboard", done: true }, { id: "b", title: "Clients", done: false }] };
    const { model, requests } = scripted(call("plan_build", plan), say("Next up: Clients."));
    const r = await runOwnerTurn({ backend, history: [], message: "recreate this", model });
    expect(JSON.parse(lastToolResult(requests[1]).content)).toEqual({ next: "Clients", remaining: 1 });
    expect(r.response.plan).toEqual(plan);
  });

  it("stops at the time budget and the next turn picks up cleanly", async () => {
    const { backend } = setup();
    const slow: ModelCall = async () => {
      await new Promise((res) => setTimeout(res, 30));
      return call("query_records", { table: "tbl_clients", limit: 1 });
    };
    const r = await runOwnerTurn({ backend, history: [], message: "do lots", model: slow, budgetMs: 10 });
    expect(r.response.text).toMatch(/continue/i);
    // History ends with tool results (a user message); the next message joins it so roles still alternate.
    expect(r.history.at(-1)!.role).toBe("user");
    const { model, requests } = scripted(say("Done."));
    await runOwnerTurn({ backend, history: r.history, message: "continue", model });
    const roles = requests[0].messages.map((m) => m.role);
    for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1]);
  });
});
