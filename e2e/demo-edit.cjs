const { chromium } = require("playwright");
/**
 * Drives Edit mode on /demo end to end. Needs a running app and Playwright:
 *   npm run build && npx next start -p 3123 &   then   BASE_URL=http://localhost:3123 node e2e/demo-edit.cjs
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3123";
const S = process.env.SCREENSHOTS ?? require("node:os").tmpdir();
const assert = require("node:assert/strict");
const log = (...a) => console.log("•", ...a);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.goto(BASE + "/demo/p/pg_today");
  await p.getByRole("button", { name: "Edit" }).click();
  await p.getByLabel("Page name").fill("Agenda");
  await p.getByLabel("Page name").press("Enter");
  log("sidebar has Agenda:", await p.locator('aside:visible input[aria-label="Rename Agenda"]').count());

  // drag revenue block right by ~4 columns
  const handle = p.locator('[data-block="blk_rev"] button[aria-label^="Move"]');
  const box = await handle.boundingBox();
  const grid = await p.locator("[data-layout]").boundingBox();
  const col = grid.width / 12;
  await p.mouse.move(box.x + 20, box.y + 8);
  await p.mouse.down();
  await p.mouse.move(box.x + 20 + col * 2, box.y + 8, { steps: 5 });
  await p.mouse.move(box.x + 20 + col * 4, box.y + 8, { steps: 5 });
  await p.mouse.up();
  const revStyle = await p.locator('[data-block="blk_rev"]').getAttribute("style");
  log("rev after drag:", revStyle);

  // resize "Up next" taller via keyboard (shift+down) on its handle
  await p.locator('[data-block="blk_next"] button[aria-label^="Move"]').focus();
  await p.keyboard.press("Shift+ArrowDown");
  log("next after resize:", await p.locator('[data-block="blk_next"]').getAttribute("style"));

  await p.locator("aside:visible").getByLabel("Hide Services").click();
  await p.getByRole("button", { name: "Block", exact: true }).click();
  await p.getByText("Note", { exact: true }).click();
  await p.getByRole("button", { name: "Add block" }).click();
  log("pending:", await p.locator("text=/\\d+ changes?/").first().textContent());
  await p.screenshot({ path: `${S}/edit-1.png` });

  await p.getByRole("button", { name: "Done" }).click();
  await p.waitForSelector('[role="status"]');
  log("toast:", (await p.locator('[role="status"]').textContent()).slice(0, 120));
  assert.equal(await p.locator("h1").textContent(), "Agenda");
  log("title:", await p.locator("h1").textContent(), "| Services in menu:", await p.locator("aside:visible nav >> text=Services").count());
  await p.screenshot({ path: `${S}/edit-2-saved.png` });

  await p.getByRole("button", { name: "Undo" }).click();
  await p.waitForTimeout(300);
  assert.equal(await p.locator("h1").textContent(), "Today");
  log("after undo title:", await p.locator("h1").textContent(), "| Services in menu:", await p.locator("aside:visible nav >> text=Services").count());

  // risky: remove a field
  await p.goto(BASE + "/demo/p/pg_clients");
  await p.getByRole("button", { name: "Edit" }).click();
  await p.locator('[data-block="blk_clients"]').getByLabel("Block settings").click();
  await p.getByLabel("Remove VIP").click();
  await p.getByLabel("Close").first().click();
  await p.getByRole("button", { name: "Done" }).click();
  await p.waitForSelector("text=Please confirm");
  log("confirm lists:", await p.locator("dialog[open] li").allTextContents());
  await p.screenshot({ path: `${S}/edit-3-confirm.png` });
  await p.getByRole("button", { name: "Yes, save" }).click();
  await p.waitForSelector('[role="status"]');
  log("saved risky:", (await p.locator('[role="status"]').textContent()).slice(0, 80));

  // invalid: remove a field a block depends on (Bookings amount used by revenue number)
  await p.goto(BASE + "/demo/p/pg_bookings");
  await p.getByRole("button", { name: "Edit" }).click();
  await p.locator('[data-block="blk_board"]').getByLabel("Block settings").click();
  await p.getByLabel("Remove Amount").click();
  await p.waitForSelector('[role="alert"].fixed');
  log("invalid edit alert:", (await p.locator('[role="alert"].fixed').textContent()).slice(0, 140));
  await p.getByLabel("Close").first().click();
  await p.getByLabel("Dismiss").click();

  // add a page from a template, navigates to the draft page
  await p.locator("aside:visible").getByRole("button", { name: "Add page" }).click();
  await p.getByLabel("Name", { exact: true }).fill("Price list");
  await p.getByText("Table", { exact: true }).click();
  await p.getByLabel("Data from").selectOption("tbl_services");
  await p.locator("dialog[open]").getByRole("button", { name: "Add page" }).click();
  await p.waitForURL(/pg_price_list/);
  log("draft page url:", p.url(), "| block placeholder:", await p.locator("text=save to load its data").count());
  await p.screenshot({ path: `${S}/edit-4-newpage.png` });
  await p.getByRole("button", { name: "Done" }).click();
  await p.waitForSelector('[role="status"]');
  assert.ok((await p.locator("aside:visible nav a").allTextContents()).includes("Price list"));
  log("menu now:", await p.locator("aside:visible nav a").allTextContents());
  assert.deepEqual(errors, []);
  log("ok");
  await b.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
