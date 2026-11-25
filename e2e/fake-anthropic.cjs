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
  // The owner's latest words: plain text, or text blocks of a merged message (notes + new message).
  const textOf = (m) => (typeof m.content === "string" ? [m.content] : m.content.filter((b) => b.type === "text").map((b) => b.text));
  const latest = [...msgs].reverse().map(textOf).flat().filter((t) => !t.startsWith("Current setup:")).find((t) => !t.startsWith("[The owner ") || t.startsWith("[The owner is looking"));
  const ownerText = (latest ?? "").replace(/^\[The owner is looking at[^\]]*\]\s*/, "");
  if (isToolResult) {
    let r = {};
    try {
      r = JSON.parse(last.content[0].content || "{}");
    } catch {
      return text(`Tool failed: ${String(last.content[0].content).slice(0, 300)}`);
    }
    if (r.status === "waiting_for_owner_confirmation") return text("I’ll do that once you confirm below.");
    if (r.component === "cmp_screen_a" || r.component === "cmp_screen_b") {
      const both = r.component === "cmp_screen_b";
      return tool("plan_build", { goal: "Recreate the app", steps: [{ id: "screen_a", title: "Screen A", done: true }, { id: "screen_b", title: "Screen B", done: both }] });
    }
    if (r.next) return text(`Plan saved. Next: ${r.next}.`);
    if (r.finished) return text("All screens built.");
    if (ownerText.includes("today")) return text(`You have ${r.total} bookings today.`);
    return text("Done — take a look.");
  }
  if (/rename/i.test(ownerText)) {
    return tool("change_setup", { summary: "Rename Clients to Guests", ops: [{ op: "rename", target: { kind: "page", pageId: "pg_clients" }, label: "Guests" }] });
  }
  const lastMsg = msgs.at(-1);
  if (lastMsg.role === "user" && Array.isArray(lastMsg.content) && lastMsg.content.some((b) => b.type === "text" && b.text.includes("[Automatic check]"))) {
    const pic = lastMsg.content.find((b) => b.type === "image");
    const jpeg = pic && pic.source.data.startsWith("/9j/");
    if (jpeg && process.env.FAKE_SAVE_DIR) require("node:fs").writeFileSync(`${process.env.FAKE_SAVE_DIR}/self-check.jpg`, Buffer.from(pic.source.data, "base64"));
    return text(jpeg ? `Checked the picture (${Math.round(pic.source.data.length / 1024)} KB): it looks right.` : "Checked: no picture arrived.");
  }
  const lastText = Array.isArray(lastMsg.content) ? lastMsg.content.filter((b) => b.type === "text").map((b) => b.text).join(" ") : String(lastMsg.content);
  if (lastMsg.role === "user" && lastText.includes("[Automatic] Continue")) {
    if (lastText.includes("next step now — Screen A")) return tool("write_component", { id: "cmp_screen_a", label: "Screen A", summary: "Screen A from the screenshot", newPage: { id: "pg_screen_a", label: "Screen A" }, source: 'import { Card } from "@one/kit";\nexport default function S() { return <Card title="Screen A"><p className="text-sm">Rebuilt from the screenshot.</p></Card>; }' });
    if (lastText.includes("next step now — Screen B")) return tool("write_component", { id: "cmp_screen_b", label: "Screen B", summary: "Screen B from the screenshot", newPage: { id: "pg_screen_b", label: "Screen B" }, source: 'import { Card } from "@one/kit";\nexport default function S() { return <Card title="Screen B"><p className="text-sm">Rebuilt from the screenshot.</p></Card>; }' });
  }
  if (lastMsg.role === "user" && /recreate/i.test(lastText)) {
    return tool("plan_build", { goal: "Recreate the app", steps: [{ id: "screen_a", title: "Screen A", done: false }, { id: "screen_b", title: "Screen B", done: false }] });
  }
  const lastUser = [...msgs].reverse().find((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "image"));
  if (lastUser && lastUser === msgs.at(-1)) {
    return tool("change_setup", { summary: "Match the design", ops: [{ op: "setTheme", theme: { colors: { accent: "#B5482B", accentHover: "#93391F", accentTint: "#F6E4DD", ground: "#FBF7F2" }, font: "DM Sans", radius: 8, menu: "top" } }] });
  }
  if (/collapsible/i.test(ownerText)) {
    return tool("write_component", {
      id: "cmp_bookings_hub",
      label: "Bookings hub",
      summary: "Bookings page with a collapsible new-booking form and upcoming bookings",
      page: "pg_bookings",
      replaceBlocks: ["blk_board"],
      inlineForm: true,
      position: { x: 0, y: 0, w: 12, h: 8 },
      source: [
        'import { Collapsible, RecordForm, useRecords, Card, Badge, Button, openRecordForm, optionLabel, formatDate, recordLabel } from "@one/kit";',
        "export default function BookingsHub() {",
        '  const { records, total } = useRecords({ table: "tbl_bookings", sort: [{ field: "fld_start", dir: "asc" }], limit: 5 });',
        '  const all = useRecords({ table: "tbl_bookings", limit: 1000 });',
        "  return (",
        '    <div className="space-y-4 p-1">',
        '      <Collapsible title="New booking" defaultOpen={false}>',
        '        <RecordForm table="tbl_bookings" fields={["fld_client", "fld_start", "fld_status"]} />',
        "      </Collapsible>",
        '      <p data-testid="all-count" className="text-xs text-muted">{all.loading ? "" : `${all.records.length}/${all.total}`}</p>',
        '      <Card title={`Upcoming (${total})`} actions={<Button size="sm" onClick={() => openRecordForm({ table: "tbl_bookings", fields: ["fld_client", "fld_start", "fld_status"] })}>Add booking</Button>}>',
        '        <ul className="divide-y divide-line">',
        "          {records.map((r) => (",
        '            <li key={r.id} className="flex items-center gap-3 py-2 text-sm" data-testid="booking-row">',
        '              <span className="flex-1">{formatDate(String(r.data.fld_start), "datetime")}</span>',
        '              <Badge>{optionLabel("tbl_bookings", "fld_status", r.data.fld_status)}</Badge>',
        "            </li>",
        "          ))}",
        "        </ul>",
        "      </Card>",
        "    </div>",
        "  );",
        "}",
      ].join("\n"),
    });
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
