#!/usr/bin/env node
/**
 * AI explorer: Claude tests a business like a curious owner would — through the business's MCP
 * tools — following a plain-English test plan, and writes a report of what works and what doesn't.
 *
 *   ONE_MCP_URL=https://<app>/api/mcp/<businessId> ONE_MCP_TOKEN=one_… npm run ai-explore -- docs/test-plans/screens.md
 *   (several plans at once: npm run ai-explore -- docs/test-plans/*.md)
 *
 * Or a fresh test business per plan (docs/testing-api.md), made and removed by the test API:
 *   ONE_APP_URL=https://<app> TEST_API_TOKEN=… npm run ai-explore -- docs/test-plans/quotes-invoices.md
 *   A plan picks its template with a line "Template: contractor" (default: appointments); KEEP=1 keeps it.
 *
 * Needs an Anthropic API key (ANTHROPIC_API_KEY or `ant auth login`). Use a TEST business: the
 * plans add records and change screens. Costs API tokens per run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const fixedUrl = process.env.ONE_MCP_URL;
const fixedToken = process.env.ONE_MCP_TOKEN;
const appUrl = process.env.ONE_APP_URL?.replace(/\/$/, "");
const testToken = process.env.TEST_API_TOKEN;
const plans = process.argv.slice(2);
if (!plans.length || (!(fixedUrl && fixedToken) && !(appUrl && testToken))) {
  console.error("Usage: ONE_MCP_URL=… ONE_MCP_TOKEN=… (or ONE_APP_URL=… TEST_API_TOKEN=…) npm run ai-explore -- <plan.md> [more plans]");
  process.exit(2);
}

/** A fresh test business for one plan (its template from a "Template: …" line). */
async function testBusiness(plan) {
  const template = /^template:\s*([a-z_]+)/im.exec(plan)?.[1] ?? "appointments";
  const r = await fetch(`${appUrl}/api/test/businesses`, { method: "POST", headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" }, body: JSON.stringify({ template, name: `AI test ${template}` }) });
  if (!r.ok) throw new Error(`Could not make a test business: ${r.status} ${await r.text()}`);
  return r.json();
}
const removeBusiness = (id) => fetch(`${appUrl}/api/test/businesses/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${testToken}` } });

const client = new Anthropic();
const SYSTEM = `You are a meticulous QA tester for One App, a platform where small businesses run their whole business in an app an AI built for them.
You test through the business's own tools (the "one_app" MCP server): read the setup first (get_setup), read the build guide before building screens (get_build_guide), then follow the test plan.
- Do every step for real with the tools. Check results by reading them back (get_record, query_records, get_setup, read_component) — never assume a step worked.
- This is a test business: create what you need; name test records and pages with "AI test" so they're easy to spot. Remove pages and custom screens you add when you're done.
- Risky changes (deleting data, changing automations, price changes) go to the owner for approval: that is expected behaviour, report it as such, don't try to get around it.
- When something fails, try once more in a sensible way, then record it and move on.
Finish with a report in Markdown:
## Summary — one line, then "RESULT: PASS" or "RESULT: FAIL"
## Steps — a table: step | what you did | expected | what happened | ✓/✗
## Problems — each bug or confusing behaviour: what, how to reproduce, how bad (blocker / annoying / cosmetic)
## Suggestions — what would make this easier for an owner or for an AI building apps`;

async function explore(planPath) {
  const plan = readFileSync(planPath, "utf8");
  const biz = fixedUrl ? null : await testBusiness(plan);
  const url = biz?.mcpUrl ?? fixedUrl;
  const token = biz?.token ?? fixedToken;
  try {
    return await run(planPath, plan, url, token, biz);
  } finally {
    if (biz && !process.env.KEEP) await removeBusiness(biz.businessId);
  }
}

async function run(planPath, plan, url, token, biz) {
  const extra = biz ? `\n\nThis is a fresh test business (${biz.name}) with sample data. Its emails and texts are captured, not sent.` : "";
  const messages = [{ role: "user", content: `Test plan (${planPath}):\n\n${plan}${extra}` }];
  let response;
  // The MCP connector runs the tool calls on Anthropic's side; a long turn may pause — continue it.
  for (let i = 0; i < 8; i++) {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      betas: ["mcp-client-2025-11-20", "server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high" },
      system: SYSTEM,
      mcp_servers: [{ type: "url", url, name: "one_app", authorization_token: token }],
      tools: [{ type: "mcp_toolset", mcp_server_name: "one_app" }],
      messages,
    });
    response = await stream.finalMessage();
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  if (response.stop_reason === "refusal") return `# ${planPath}\n\nThe model declined this plan (${response.stop_details?.category ?? "no category"}).`;
  const calls = response.content.filter((b) => b.type === "mcp_tool_use").length;
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  console.error(`${planPath}: ${calls} tool calls in the last turn, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens`);
  return `# ${planPath}\n\n${text}`;
}

const reports = [];
for (const p of plans) {
  try {
    reports.push(await explore(p));
  } catch (e) {
    if (e instanceof Anthropic.APIError) reports.push(`# ${p}\n\nAPI error ${e.status}: ${e.message}`);
    else throw e;
  }
}
const out = `${reports.join("\n\n---\n\n")}\n`;
writeFileSync("ai-explore-report.md", out);
console.log(out);
const failed = reports.some((r) => /RESULT:\s*FAIL/.test(r) || /API error|declined/.test(r));
process.exit(failed ? 1 : 0);
