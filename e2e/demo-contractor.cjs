/**
 * Contractor demo end to end: Today's numbers, a quote as the client sees it, an overdue invoice
 * with its payment, the jobs board.
 *   BASE_URL=http://localhost:3123 node e2e/demo-contractor.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE_URL ?? "http://localhost:3123";
const log = (...a) => console.log("•", ...a);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(BASE + "/demo?type=contractor");
    await p.getByText("Demo: Greenline Landscaping").waitFor();
    await p.getByText("$482.75 overdue").waitFor();
    await p.locator("nav a", { hasText: "Invoices" }).getByText("1 overdue").waitFor();
    log("Today: overdue money in the greeting and the menu");

    await p.goto(BASE + "/demo/p/pg_quotes");
    await p.locator("table tbody tr", { hasText: "Backyard makeover" }).click();
    await p.locator("article").getByText("Scope of work").waitFor();
    await p.getByText("Q-0001").first().waitFor();
    const total = await p.locator("article dl div", { hasText: "Total" }).last().textContent();
    assert.match(total, /\$3,748\.50/);
    await p.getByRole("button", { name: /Send quote/ }).click();
    await p.getByText(/emails the quote/).waitFor();
    log("quote: scope, lines, total with tax, Send explains itself in the demo");

    await p.goto(BASE + "/demo/p/pg_invoices");
    await p.locator("table tbody tr", { hasText: "INV-0001" }).click();
    await p.getByText("Overdue", { exact: true }).first().waitFor();
    await p.getByText("Balance", { exact: true }).first().waitFor();
    await p.getByText("E-transfer").first().waitFor();
    log("invoice: overdue, deposit paid, balance left");

    await p.goto(BASE + "/demo/p/pg_jobs");
    await p.locator("[data-board-column]").first().locator("article").first().waitFor();
    assert.ok((await p.getByRole("button", { name: /^Move to / }).count()) > 0, "next-stage buttons on job cards");
    log("jobs board with next-stage buttons");
    assert.deepEqual(errors, []);
    log("ok");
  } catch (e) {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
