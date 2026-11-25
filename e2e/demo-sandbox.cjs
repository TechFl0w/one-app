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
  await p.getByRole("button", { name: "Ask the assistant" }).click();
  await p.getByLabel("Message").fill("make the new booking form collapsible with a chevron");
  await p.getByLabel("Message").press("Enter");
  await p.waitForSelector("text=Add custom component “Bookings hub”");
  await p.getByLabel("Close assistant").click().catch(() => {});

  const frame = p.frameLocator('iframe[title="Bookings hub"]');
  await frame.getByText("New booking").waitFor();
  const t0 = Date.now();
  await frame.locator('[data-testid="booking-row"]').first().waitFor();
  const rows = await frame.locator('[data-testid="booking-row"]').count();
  log("rows from the bridge:", rows, `(${Date.now() - t0} ms)`);
  assert.ok(rows > 0);
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
  await frame.getByRole("button", { name: /New booking/ }).click();
  await p.waitForTimeout(800);
  assert.equal(await height(), closed, "and shrinks back when it closes");
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

  assert.deepEqual(errors, []);
  log("ok");
  await b.close();
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
