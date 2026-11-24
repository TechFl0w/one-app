/**
 * Drives the assistant panel on /demo against e2e/fake-anthropic.cjs (see that file).
 *   BASE_URL=http://localhost:3123 node e2e/demo-chat.cjs
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
  await p.goto(BASE + "/demo/p/pg_today");
  await p.getByRole("button", { name: "Ask the assistant" }).click();
  const ask = async (q) => {
    const before = await p.locator("aside[aria-label=Assistant] p.bg-ground").count();
    await p.getByLabel("Message").fill(q);
    await p.getByLabel("Message").press("Enter");
    await p.waitForFunction((n) => document.querySelectorAll("aside[aria-label=Assistant] p.bg-ground").length > n, before);
    return p.locator("aside[aria-label=Assistant] p.bg-ground").last().textContent();
  };

  const a1 = await ask("how many bookings today?");
  log("read:", a1);
  assert.match(a1, /You have \d+ bookings today/);

  const a2 = await ask("rename clients to guests");
  log("change:", a2);
  assert.equal(a2, "Done — take a look.");
  await p.waitForSelector("text=Rename page “Clients” to “Guests”");
  assert.equal(await p.locator("aside nav >> text=Guests").count(), 1, "sidebar shows the renamed page");
  await p.getByRole("button", { name: "Undo" }).click();
  await p.waitForSelector("text=Undone");
  assert.equal(await p.locator("aside nav >> text=Clients").count(), 1, "undo restored the label");
  log("undo ok");

  const a3 = await ask("pause the reminders");
  log("risky:", a3);
  await p.waitForSelector("text=Needs your OK");
  await p.screenshot({ path: (process.env.SCREENSHOTS ?? require("node:os").tmpdir()) + "/chat-confirm.png" });
  await p.getByRole("button", { name: "Confirm" }).click();
  await p.waitForSelector("text=Done");
  log("confirm ok");

  assert.deepEqual(errors, []);
  log("ok");
  await b.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
