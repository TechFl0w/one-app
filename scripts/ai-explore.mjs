#!/usr/bin/env node
/**
 * AI explorer: Claude tests a business like a curious owner would — through the business's MCP
 * tools — following a plain-English test plan, and writes a report of what works and what doesn't.
 *
 *   ONE_MCP_URL=https://<app>/api/mcp/<businessId> ONE_MCP_TOKEN=one_… npm run ai-explore -- docs/test-plans/screens.md
 *   (several plans at once: npm run ai-explore -- docs/test-plans/*.md)
 *
 * Needs an Anthropic API key (ANTHROPIC_API_KEY or `ant auth login`). Use a TEST business: the
 * plans add records and change screens. Costs API tokens per run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const url = process.env.ONE_MCP_URL;
const token = process.env.ONE_MCP_TOKEN;
const plans = process.argv.slice(2);
if (!url || !token || !plans.length) {
  console.error("Usage: ONE_MCP_URL=… ONE_MCP_TOKEN=… npm run ai-explore -- <plan.md> [more plans]");
  process.exit(2);
}

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
  const messages = [{ role: "user", content: `Test plan (${planPath}):\n\n${plan}` }];
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
