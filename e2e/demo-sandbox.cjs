/**
 * Generated UI end to end on /demo: the assistant writes a component (fake model), it renders in
 * the sandboxed frame with real data, and the frame can't reach the app, cookies or the network.
 *   BASE_URL=http://localhost:3123 node e2e/demo-sandbox.cjs   (with e2e/fake-anthropic.cjs running)
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE_URL ?? "http://localhost:3123";
const S = process.env.SCREENSHOTS ?? require("node:os").tmpdir();
const log = (...a) => console.log("•", ...a);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(BASE + "/demo/p/pg_bookings");
  // Board cards open their record too (not only table rows).
  await p.locator("article[role=button]").first().click();
  await p.locator("dialog[open]").getByRole("button", { name: "Delete" }).waitFor();
  await p.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
  log("board cards open the record pop-up");
  await p.getByRole("button", { name: "Ask the assistant" }).click();
  await p.getByLabel("Message").fill("make the new booking form collapsible with a chevron");
  await p.getByLabel("Message").press("Enter");
  await p.waitForSelector("text=Add screen “Bookings hub”");

  // Self-check: the app pictures the new component and sends it back; the assistant confirms.
  await p.waitForSelector("text=Checking how it looks…", { timeout: 60000 });
  const check = await p.waitForSelector("text=/Checked the picture \\(\\d+ KB\\): it looks right/", { timeout: 60000 });
  log("self-check:", await check.textContent());
  await p.getByLabel("Close assistant").click().catch(() => {});
  const frame = p.frameLocator('iframe[title="Bookings hub"]');
  await frame.getByText("New booking").waitFor();
  const t0 = Date.now();
  await frame.locator('[data-testid="booking-row"]').first().waitFor();
  const rows = await frame.locator('[data-testid="booking-row"]').count();
  log("rows from the bridge:", rows, `(${Date.now() - t0} ms)`);
  assert.ok(rows > 0);
  // Asking for more than one page (limit 1000) still loads everything, page by page.
  await frame.locator('[data-testid="all-count"]').filter({ hasText: "/" }).waitFor();
  const [got, of] = (await frame.locator('[data-testid="all-count"]').textContent()).split("/").map(Number);
  log("limit 1000 →", got, "of", of);
  assert.ok(got > 0 && got === of, "a big limit is paged, not rejected");
  assert.equal(await frame.getByText("Client").count(), 0, "collapsed by default");
  const height = () => p.locator('iframe[title="Bookings hub"]').evaluate((e) => Math.round(e.getBoundingClientRect().height));
  await p.waitForTimeout(800);
  const closed = await height();
  await frame.getByRole("button", { name: /New booking/ }).click();
  await frame.getByText("Client").first().waitFor();
  await p.waitForTimeout(800);
  const opened = await height();
  log("chevron opens the form; frame height", closed, "→", opened);
  assert.ok(opened > closed + 150, "frame grows when the section opens");
  // The inline form really submits inside the sandbox: an empty save names what's missing.
  await frame.getByRole("button", { name: "Save" }).click();
  await frame.getByText(/Please fill in .*Client/).waitFor({ timeout: 5000 });
  log("inline form submits (required fields are checked)");
  // Kit dropdowns close when you pick, and only one popover is open at a time.
  const lists = () => frame.locator('[role="listbox"]').count();
  await frame.getByRole("button", { name: /Choose…/ }).first().click();
  assert.equal(await lists(), 1);
  const client = (await frame.locator('[role="option"]').first().textContent()).trim();
  await frame.locator('[role="option"]').first().click();
  await p.waitForTimeout(200);
  assert.equal(await lists(), 0, "dropdown closes on pick");
  await frame.getByRole("button", { name: /Pick a date/ }).click();
  await frame.getByText("Mo", { exact: true }).waitFor();
  await frame.getByRole("button", { name: client }).first().click();
  await p.waitForTimeout(200);
  assert.equal(await frame.getByText("Mo", { exact: true }).count(), 0, "calendar closes when another dropdown opens");
  await frame.locator("body").press("Escape");
  await p.waitForTimeout(200);
  assert.equal(await lists(), 0, "Escape closes");
  log("dropdowns close on pick, outside click and Escape");
  // With a client and a date, the form saves.
  await frame.getByRole("button", { name: /Pick a date/ }).click();
  await frame.getByRole("button", { name: "15", exact: true }).click();
  await frame.getByRole("button", { name: "Save" }).click();
  await p.getByRole("status").filter({ hasText: /added/i }).waitFor({ timeout: 10000 });
  log("inline form saved a booking");
  await frame.getByRole("button", { name: /New booking/ }).click();
  await p.waitForTimeout(800);
  assert.equal(await height(), closed, "and shrinks back when it closes");

  // Add screens are One App's own modal over the whole page.
  await frame.getByRole("button", { name: "Add booking" }).click();
  const dialog = p.locator("dialog[open]");
  await dialog.getByText("New booking").waitFor();
  assert.ok((await dialog.locator("label").count()) >= 3, "modal shows the form fields");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("dialog[open]").count(), 0);
  log("openRecordForm opens the app's modal");
  await p.screenshot({ path: `${S}/sandbox-hub.png` });

  // The frame is a stranger to the app: opaque origin, no cookies, no parent DOM, no network.
  const el = await p.locator('iframe[title="Bookings hub"]').elementHandle();
  const inner = await el.contentFrame();
  const probe = await inner.evaluate(async () => {
    const out = {};
    try { out.cookie = document.cookie; } catch { out.cookie = "blocked"; }
    try { out.parent = window.parent.document.title; } catch { out.parent = "blocked"; }
    try { await fetch("/api/mcp", { method: "POST" }); out.fetch = "allowed"; } catch { out.fetch = "blocked"; }
    out.origin = window.origin;
    return out;
  });
  log("isolation:", JSON.stringify(probe));
  assert.equal(probe.cookie, "blocked");
  assert.equal(probe.parent, "blocked");
  assert.equal(probe.fetch, "blocked");
  assert.equal(probe.origin, "null");

  // A design image → the assistant changes the theme → the app and the frame pick it up.
  await p.getByRole("button", { name: "Ask the assistant" }).click().catch(() => {});
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await p.locator('input[type=file][accept="image/*"]').setInputFiles({ name: "design.png", mimeType: "image/png", buffer: png });
  await p.waitForSelector('ul[aria-label="Attached images"] img');
  await p.getByLabel("Message").fill("make it look like this");
  await p.getByLabel("Message").press("Enter");
  await p.waitForSelector("text=Change the look (colours, fonts, shape)");
  await p.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().toLowerCase() === "#b5482b");
  await p.frameLocator('iframe[title="Bookings hub"]').getByText("New booking").waitFor();
  const innerFont = await (await (await p.locator('iframe[title="Bookings hub"]').elementHandle()).contentFrame()).evaluate(() => getComputedStyle(document.body).fontFamily);
  log("theme applied: app accent #b5482b, frame font", innerFont);
  assert.match(innerFont, /DM Sans/);
  // The design also moved the menu to a top bar.
  await p.waitForSelector('header nav[aria-label="Pages"] >> text=Bookings');
  assert.equal(await p.locator("aside.md\\:flex").count(), 0, "no sidebar with a top menu");
  log("menu moved to the top bar");
  await p.getByLabel("Close assistant").click().catch(() => {});
  await p.screenshot({ path: `${S}/sandbox-themed.png` });

  // Standard tables: a row opens the record pop-up with Delete; Add opens a new one.
  await p.getByLabel("Close assistant").click().catch(() => {});
  await p.goto(BASE + "/demo/p/pg_clients");
  await p.locator("table tbody tr").first().click();
  const pop = p.locator("dialog[open]");
  await pop.getByRole("button", { name: "Delete" }).waitFor();
  await pop.getByRole("button", { name: "Cancel" }).click();
  await p.getByRole("button", { name: /^Add / }).first().click();
  await p.locator("dialog[open]").getByText(/^New /).waitFor();
  await p.locator("dialog[open]").getByRole("button", { name: "Cancel" }).click();
  log("table rows open the record pop-up (edit + delete), Add opens a new one");

  // A screen that crashes goes back to the assistant automatically and gets fixed.
  await p.getByRole("button", { name: "Ask the assistant" }).click().catch(() => {});
  await p.getByLabel("Message").fill("make a broken screen");
  await p.getByLabel("Message").press("Enter");
  await p.waitForSelector("text=Fixing an error in the new screen…", { timeout: 60000 });
  await p.frameLocator('iframe[title="Flaky"]').getByText("Fixed screen").waitFor({ timeout: 60000 });
  log("crashing screen was sent back and fixed automatically");

  assert.deepEqual(errors, []);
  log("ok");
  await b.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
