/**
 * Recreating an app from screenshots on /demo (fake model): plan → screen A → self-check →
 * screen B → done, continuing automatically with the screenshots each step.
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
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await p.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: png },
    { name: "b.png", mimeType: "image/png", buffer: png },
  ]);
  await p.waitForFunction(() => document.querySelectorAll('ul[aria-label="Attached images"] img').length === 2);
  await p.getByLabel("Message").fill("Recreate this app");
  await p.getByLabel("Message").press("Enter");
  for (const step of ["Next: Screen A…", "Checking how it looks…", "Next: Screen B…", "All screens built."]) {
    await p.waitForSelector(`text=${step}`, { timeout: 90000 });
    log("saw:", step);
  }
  const menu = await p.locator("aside nav").first().innerText();
  assert.match(menu, /Screen A/);
  assert.match(menu, /Screen B/);
  log("both screens are pages now");
  assert.deepEqual(errors, []);
  log("ok");
  await b.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
