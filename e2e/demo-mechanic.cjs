/**
 * The mechanic shop template, end to end on /demo?type=mechanic (sample data, nothing saved):
 * Today's numbers, the workshop board (drag), a job's own page with computed totals, and links
 * from the job to its vehicle's page.
 *   BASE_URL=http://localhost:3123 node e2e/demo-mechanic.cjs
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE_URL ?? "http://localhost:3123";
const S = process.env.SCREENSHOTS ?? require("node:os").tmpdir();
const log = (...a) => console.log("•", ...a);

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  try {
    await p.goto(BASE + "/demo?type=mechanic");
    await p.waitForURL(/\/demo\/p\/pg_today$/);
    await p.getByText("Demo: Northside Auto Repair").waitFor();
    // Cars in the shop, waiting for approval, ready for pickup, late.
    await p.locator("p.text-4xl").first().waitFor();
    assert.deepEqual(await p.locator("p.text-4xl").allTextContents(), ["4", "1", "1", "1"]);
    // The greeting's live line and the menu's counts.
    await p.getByText("$485 to collect").waitFor();
    await p.locator("nav a", { hasText: "Jobs" }).getByText("1 late").waitFor();
    log("Today: 4 cars in the shop, 1 late");

    await p.goto(BASE + "/demo/p/pg_workshop");
    const cols = p.locator("[data-board-column]");
    await cols.first().locator("article").first().waitFor();
    const card = cols.first().locator("article").first();
    const cb = await card.boundingBox();
    const tb = await cols.nth(1).boundingBox();
    await p.mouse.move(cb.x + 20, cb.y + 15);
    await p.mouse.down();
    await p.mouse.move(cb.x + 60, cb.y + 40, { steps: 4 });
    await p.mouse.move(tb.x + tb.width / 2, tb.y + 80, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(150);
    assert.equal(await cols.nth(1).locator("article").count(), 1, "job moved to Checked in");
    // Or one tap on its next step.
    await cols.nth(1).getByRole("button", { name: "Move to Diagnosing", exact: true }).click();
    await p.waitForTimeout(150);
    assert.equal(await cols.nth(2).locator("article").count(), 1, "job moved on to Diagnosing");
    log("workshop board: a job drags from Booked to Checked in, then taps on to Diagnosing");

    await p.goto(BASE + "/demo/p/pg_jobs");
    await p.locator("table tbody tr", { hasText: "Front brakes grinding" }).click();
    await p.waitForURL(/\/demo\/r\/tbl_jobs\//);
    await p.getByText("$305").first().waitFor(); // balance = approved lines 405 − paid 100
    await p.getByText("Part paid").first().waitFor();
    await p.getByText("Late", { exact: true }).first().waitFor();
    await p.getByText("Labour: replace pads and rotors").waitFor();
    await p.screenshot({ path: `${S}/mechanic-job.png`, fullPage: true });
    log("job page: lines, balance $305, part paid, late");

    await p.locator("a", { hasText: "BC 4KX 21" }).first().click();
    await p.waitForURL(/\/demo\/r\/tbl_vehicles\//);
    await p.getByText("Service history").waitFor();
    await p.getByText("Due soon").first().waitFor();
    log("vehicle page from the job: service history, service due soon");

    assert.deepEqual(errors, []);
    log("ok");
  } catch (e) {
    console.error("FAILED:", e.message);
    await p.screenshot({ path: `${S}/mechanic-failed.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await b.close();
  }
})();
