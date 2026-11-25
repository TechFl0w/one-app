const { chromium, devices } = require("playwright");
/** Books an appointment on /book/demo from a phone. BASE_URL=http://localhost:3123 node e2e/demo-booking.cjs */
const BASE = process.env.BASE_URL ?? "http://localhost:3123";
(async () => {
  const S = process.env.SCREENSHOTS ?? require("node:os").tmpdir();
  const b = await chromium.launch();
  const c = await b.newContext({ ...devices["iPhone 13"] });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(BASE + "/book/demo");
  await p.screenshot({ path: `${S}/book-1.png` });
  await p.getByText("Gel manicure").click();
  await p.getByRole("button", { name: "Anyone available" }).click();
  // One screen: the calendar opens on the first free day; times are grouped by part of the day.
  const first = p.locator("main button[aria-pressed]", { hasText: /^\d{1,2}:\d{2}/ }).first();
  await first.waitFor();
  await p.screenshot({ path: `${S}/book-3.png`, fullPage: true });
  const t = await first.textContent();
  await first.click();
  await p.getByLabel("Name").fill("Test Person");
  await p.getByLabel("Email").fill("test@example.com");
  await p.getByRole("button", { name: "Book appointment" }).click();
  await p.getByText("You’re booked in").or(p.getByText("Request sent")).waitFor();
  await p.screenshot({ path: `${S}/book-4.png` });
  console.log("picked", t, "|", (await p.locator("main").textContent()).replace(/\s+/g, " ").slice(0, 220));
  if (errs.length) throw new Error(errs.join("; "));
  console.log("• ok");
  await b.close();
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
