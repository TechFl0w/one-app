# AI test plans

Plain-English plans Claude follows when testing a business through its MCP tools:

```
ONE_MCP_URL=https://<app>/api/mcp/<businessId> ONE_MCP_TOKEN=one_… npm run ai-explore -- docs/test-plans/screens.md
```

Writes `ai-explore-report.md` (steps, problems, suggestions; exits 1 on FAIL). Use a test business.

The fixed checks (`src/testing/scenarios.ts`) run in CI on every template in memory, and against a
live business with `npm run ai-test` (same env vars; writes `ai-test-report.txt`).

Add a plan: a goal line, then numbered steps saying what to do and what should happen.
