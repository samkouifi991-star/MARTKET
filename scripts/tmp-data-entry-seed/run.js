// Temporary, one-off automation for Phase F Batch 2 economic-data seeding
// via the real Admin Data Entry form (not a new ingestion path). Deleted
// after use; not part of the shipped app. Authenticates by setting the
// "mi_session" cookie directly against a short-lived session row inserted
// ahead of time (see session.ts's SESSION_COOKIE_NAME) — never touches or
// needs the QA account's actual password.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.SEED_BASE_URL || "https://martket-nine.vercel.app";
const SESSION_TOKEN = process.env.SEED_SESSION_TOKEN;
const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "entries.json"), "utf8"));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const url = new URL(BASE);
  await context.addCookies([
    {
      name: "mi_session",
      value: SESSION_TOKEN,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();

  console.log("Verifying session cookie auth...");
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  console.log("Post-auth URL:", page.url());

  console.log("Screenshotting BEFORE coverage state...");
  await page.goto(`${BASE}/admin/economic-coverage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "shots/coverage-before.png", fullPage: true });

  const results = [];
  for (const e of entries) {
    console.log(`Submitting: ${e.currency} ${e.event} ...`);
    await page.goto(`${BASE}/admin/data-entry`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);

    await page.selectOption('select[name="currency"]', e.currency);
    if (e.impact) await page.selectOption('select[name="impact"]', e.impact);
    await page.fill('input[name="event"]', e.event);
    await page.fill('input[name="releaseDate"]', e.releaseDate);
    await page.fill('input[name="releaseTime"]', e.releaseTime);
    if (e.actual) await page.fill('input[name="actual"]', e.actual);
    if (e.forecast) await page.fill('input[name="forecast"]', e.forecast);
    if (e.previous) await page.fill('input[name="previous"]', e.previous);
    if (e.revisedPrevious) await page.fill('input[name="revisedPrevious"]', e.revisedPrevious);
    if (e.notes) await page.fill('textarea[name="notes"]', e.notes);

    await page.click('button:has-text("Save & Process")');
    await page.waitForTimeout(1500);

    const successText = await page.locator("p.text-emerald-400").first().textContent().catch(() => null);
    const errorText = await page.locator("p.text-rose-400").first().textContent().catch(() => null);
    console.log(`  -> success: ${successText}, error: ${errorText}`);
    results.push({ id: e.id, currency: e.currency, event: e.event, success: successText, error: errorText });
  }

  fs.mkdirSync("shots", { recursive: true });
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));

  console.log("Screenshotting AFTER coverage state...");
  await page.goto(`${BASE}/admin/economic-coverage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "shots/coverage-after.png", fullPage: true });

  for (const sym of ["AUDUSD", "USDJPY", "XAUUSD"]) {
    console.log(`Screenshotting ${sym} scorecard...`);
    await page.goto(`${BASE}/markets/${sym}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `shots/${sym}.png`, fullPage: true });
  }

  await browser.close();
  console.log("DONE");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
