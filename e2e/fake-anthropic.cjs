/**
 * Minimal stand-in for the Messages API so the chat can be tested end to end without a key:
 *   node e2e/fake-anthropic.cjs 4010 &
 *   ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test npx next start
 * Scripted by keywords in the latest owner message.
 */
const http = require("node:http");
const port = Number(process.argv[2] ?? 4010);

const reply = (content, stop_reason) => ({
  id: `msg_${Date.now()}`, type: "message", role: "assistant", model: "claude-opus-5-5",
  content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
});
const text = (t) => reply([{ type: "text", text: t }], "end_turn");
const tool = (name, input) => reply([{ type: "tool_use", id: `toolu_${Date.now()}`, name, input }], "tool_use");

function script(body) {
  const msgs = body.messages;
  const last = msgs.at(-1);
  const isToolResult = Array.isArray(last.content) && last.content[0]?.type === "tool_result";
  const latest = [...msgs].reverse().find((m) => m.role === "user" && typeof m.content === "string" && (!m.content.startsWith("[The owner ") || m.content.startsWith("[The owner is looking")));
  const ownerText = (latest?.content ?? "").replace(/^\[The owner is looking at[^\]]*\]\s*/, "");
  if (isToolResult) {
    const r = JSON.parse(last.content[0].content || "{}");
    if (r.status === "waiting_for_owner_confirmation") return text("I’ll do that once you confirm below.");
    if (ownerText.includes("today")) return text(`You have ${r.total} bookings today.`);
    return text("Done — take a look.");
  }
  if (/rename/i.test(ownerText)) {
    return tool("change_setup", { summary: "Rename Clients to Guests", ops: [{ op: "rename", target: { kind: "page", pageId: "pg_clients" }, label: "Guests" }] });
  }
  if (/pause/i.test(ownerText)) {
    return tool("change_setup", { summary: "Pause reminders", ops: [{ op: "toggleAutomation", automationId: "aut_reminder", enabled: false }] });
  }
  if (/today/i.test(ownerText)) {
    return tool("query_records", { table: "tbl_bookings", filters: [{ field: "fld_start", op: "eq", value: "@today" }] });
  }
  return text("Hello! How can I help?");
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      res.setHeader("content-type", "application/json");
      if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end("{}");
      res.end(JSON.stringify(script(body)));
    });
  })
  .listen(port, () => console.log(`fake anthropic on ${port}`));
