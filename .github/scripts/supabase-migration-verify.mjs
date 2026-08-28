// One-off verification script for the Neon -> Supabase migration + manual
// data-entry / Zapier ingestion pipeline. Run from
// .github/workflows/supabase-migration-verify.yml on a GitHub Actions
// runner (unrestricted egress) against the real deployed production app —
// this sandbox cannot reach *.vercel.app directly (see this project's
// established pattern in economic-release-watch.yml/launch-audit.yml).
//
// Everything is printed to this job's own stdout between clear markers
// (CHECK[...], BEGIN_SHOT_B64/END_SHOT_B64, etc.) so it can be read back
// via the GitHub Actions API instead of a direct blob/artifact fetch
// (also unreachable from the sandbox that orchestrates this). Screenshots
// are JPEG-compressed to keep the base64 log payload manageable.
//
// Never touches the database directly — everything here goes through the
// real HTTP surface (pages + the manual-entry Server Actions via a real
// browser session), exactly as a human operator would.
import { chromium } from "playwright";
import fs from "node:fs";

const baseUrl = process.env.APP_BASE_URL;
const qaEmail = process.env.QA_EMAIL;
const qaPassword = process.env.QA_PASSWORD;

if (!baseUrl || !qaEmail || !qaPassword) {
  console.error("Missing required env: APP_BASE_URL, QA_EMAIL, QA_PASSWORD");
  process.exit(1);
}

const DESKTOP = { width: 1360, height: 1400 };
const MOBILE = { width: 390, height: 1600 };

const results = []; // { label, pass, detail }
function record(label, pass, detail = "") {
  results.push({ label, pass, detail });
  console.log(`CHECK[${label}]: ${pass ? "PASS" : "FAIL"}${detail ? " — " + detail : ""}`);
}

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

function containsAll(text, fragments) {
  const missing = fragments.filter((f) => !text.includes(f));
  return { ok: missing.length === 0, missing };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: DESKTOP });
const page = await context.newPage();
// Vercel serverless cold starts on routes this run hasn't hit yet can
// comfortably exceed Playwright's 30s default action timeout — raise it
// generously rather than have one slow compile abort the whole run.
page.setDefaultTimeout(60000);

// Runs one labeled section; on failure, logs it as a FAILed check and
// keeps going rather than aborting every later section (and screenshot)
// over one page's problem.
async function section(label, fn) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(label, false, `threw: ${message.split("\n")[0]}`);
    console.log(`SECTION_FAILED[${label}] url=${page.url()}`);
  }
}

async function shot(name) {
  const path = `${name.replace(/[^a-z0-9-]+/gi, "_")}.jpg`;
  await page.screenshot({ path, fullPage: true, type: "jpeg", quality: 45 });
  const size = fs.statSync(path).size;
  const b64 = fs.readFileSync(path).toString("base64");
  console.log(`SHOT_CAPTURED: ${name} bytes=${size} base64Length=${b64.length}`);
  console.log(`BEGIN_SHOT_B64:${name}`);
  console.log(b64);
  console.log(`END_SHOT_B64:${name}`);
}

async function goto(path, opts = {}) {
  const url = `${baseUrl}${path}`;
  const resp = await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(opts.settleMs ?? 1800);
  return resp;
}

try {
  // ===== AUTH: QA admin signup, falling back to signin if already exists =====
  console.log("=== AUTH ===");
  await goto("/signup");
  await page.fill("#email", qaEmail);
  await page.fill("#password", qaPassword);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  let bodyText = await textOf(page);

  if (bodyText.includes("already exists")) {
    console.log("AUTH: account already exists — signing in instead");
    await goto("/signin");
    await page.fill("#email", qaEmail);
    await page.fill("#password", qaPassword);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    bodyText = await textOf(page);
  }

  await goto("/admin");
  const adminUrl = page.url();
  const adminText = await textOf(page);
  const adminOk = adminUrl.includes("/admin") && !adminUrl.includes("/paywall") && !adminUrl.includes("/signin");
  record("qa-admin-access", adminOk, `url=${adminUrl}`);

  // ===== BASELINE SCREENSHOTS (don't depend on manual entry) =====
  console.log("=== BASELINE SCREENSHOTS ===");
  await goto("/");
  await shot("01-dashboard");

  await goto("/markets/GBPUSD");
  await shot("02-ai-market-scorecard-gbpusd-before");

  await goto("/forex-scorecard");
  await shot("03-forex-scorecard");

  await goto("/top-setups");
  await shot("04-top-setups");

  await goto("/economic-strength");
  await shot("05-economic-strength");

  await goto("/economic-heatmap");
  await shot("06-economic-heatmap-before");

  await goto("/institutional");
  await shot("07-institutional-positioning");

  await goto("/retail-sentiment");
  await shot("08-retail-sentiment");

  await goto("/carry-trade");
  await shot("09-carry-trade");

  await goto("/geopolitical-risk");
  await shot("10-geopolitical-risk-before");

  await goto("/features");
  await shot("11-explore-features");

  // ===== MANUAL ECONOMIC RELEASE ENTRY (exact spec example) =====
  console.log("=== MANUAL ECONOMIC ENTRY ===");
  await section("manual-economic-entry-saved", async () => {
    await goto("/admin/data-entry", { settleMs: 3000 });
    console.log(`PAGE_URL_AFTER_GOTO: ${page.url()}`);
    await page.waitForSelector('select[name="currency"]', { timeout: 60000 });
    const today = new Date().toISOString().slice(0, 10);
    await page.selectOption('select[name="currency"]', "USD");
    await page.selectOption('select[name="impact"]', "High");
    await page.fill('input[name="event"]', "CPI m/m");
    await page.fill('input[name="releaseDate"]', today);
    await page.fill('input[name="releaseTime"]', "13:30");
    await page.fill('input[name="actual"]', "0.4%");
    await page.fill('input[name="forecast"]', "0.2%");
    await page.fill('input[name="previous"]', "0.1%");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    const econEntryText = await textOf(page);
    const econSaved = econEntryText.includes("Saved") && econEntryText.includes("surprise-scored");
    record("manual-economic-entry-saved", econSaved, econSaved ? "" : "expected 'Saved — surprise-scored' message not found");
    await shot("12-admin-data-entry");
  });

  await section("incoming-data-shows-manual-cpi-row", async () => {
    await goto("/admin/incoming-data");
    const incomingText = await textOf(page);
    const incomingCheck = containsAll(incomingText, ["Manual (Admin)", "CPI m/m", "USD"]);
    record("incoming-data-shows-manual-cpi-row", incomingCheck.ok, incomingCheck.missing.join(", "));
    await shot("13-admin-incoming-data");
  });

  await section("economic-calendar-shows-cpi-release", async () => {
    await goto("/economic-calendar");
    // Default "when" filter is "Upcoming" (dateTime >= now) — the release
    // we just entered is scheduled for today, which may already be in the
    // past relative to whenever this job happens to run. Switch to "All"
    // so visibility never depends on wall-clock timing.
    await page.click('button:has-text("All")').catch(() => {});
    await page.waitForTimeout(300);
    const calendarText = await textOf(page);
    const calendarCheck = containsAll(calendarText, ["CPI m/m", "USD"]);
    record("economic-calendar-shows-cpi-release", calendarCheck.ok, calendarCheck.missing.join(", "));
    const surpriseTextHit = /0\.4/.test(calendarText) && /0\.2/.test(calendarText);
    record("economic-calendar-shows-actual-forecast-values", surpriseTextHit);
    await shot("14-economic-surprise-calendar");
  });

  await section("inflation-page-snippet", async () => {
    await goto("/inflation");
    const inflationText = await textOf(page);
    console.log("INFLATION_PAGE_TEXT_SNIPPET:", inflationText.slice(0, 400).replace(/\n+/g, " | "));
  });

  await section("economic-heatmap-after", async () => {
    await goto("/economic-heatmap");
    await shot("06b-economic-heatmap-after");
  });

  await section("ai-market-scorecard-after", async () => {
    await goto("/markets/GBPUSD");
    await shot("02b-ai-market-scorecard-gbpusd-after");
  });

  // ===== MANUAL NEWS / GEOPOLITICAL EVENT ENTRY (exact spec example) =====
  console.log("=== MANUAL NEWS ENTRY ===");
  await section("manual-news-entry-saved", async () => {
    await goto("/admin/data-entry", { settleMs: 3000 });
    console.log(`PAGE_URL_AFTER_GOTO: ${page.url()}`);
    await page.waitForSelector('button:has-text("News / Geopolitical Event")', { timeout: 60000 });
    await page.click('button:has-text("News / Geopolitical Event")');
    await page.waitForTimeout(300);
    const todayNews = new Date().toISOString().slice(0, 10);
    await page.fill('input[name="headline"]', "Fed signals rates may remain higher for longer");
    await page.fill('input[name="source"]', "Forex Factory");
    await page.selectOption('select[name="impact"]', "High");
    await page.fill('input[name="publishedDate"]', todayNews);
    await page.fill('input[name="publishedTime"]', "18:00");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    const newsEntryText = await textOf(page);
    const newsSaved = newsEntryText.includes("Saved and classified");
    record("manual-news-entry-saved", newsSaved, newsSaved ? "" : "expected 'Saved and classified' message not found");
  });

  await section("incoming-data-shows-manual-news-row", async () => {
    await goto("/admin/incoming-data");
    const incomingText2 = await textOf(page);
    const incomingNewsCheck = containsAll(incomingText2, ["Manual (Admin)", "Fed signals rates"]);
    record("incoming-data-shows-manual-news-row", incomingNewsCheck.ok, incomingNewsCheck.missing.join(", "));
    // "Rules" (deterministic classifier) is the expected value since
    // ANTHROPIC_API_KEY is deliberately not configured (not a launch
    // blocker) — this is the concrete proof the app works without it.
    const classifierIsRules = incomingText2.includes("Rules");
    record("classifier-source-is-rules-no-anthropic-required", classifierIsRules);
  });

  await section("news-intelligence-shows-headline", async () => {
    await goto("/news");
    const newsIntelText = await textOf(page);
    const newsIntelCheck = containsAll(newsIntelText, ["Fed signals rates"]);
    record("news-intelligence-shows-headline", newsIntelCheck.ok, newsIntelCheck.missing.join(", "));
  });

  await section("geopolitical-risk-after", async () => {
    await goto("/geopolitical-risk");
    const geoRiskText = await textOf(page);
    const geoRiskShowsItem = geoRiskText.includes("Fed signals rates");
    // Not necessarily a failure: without ANTHROPIC_API_KEY, the
    // deterministic fallback classifier deliberately sets
    // monetaryPolicyRelevance/geopoliticalRelevance to 0 (see
    // src/lib/ingestion/news.ts's catch block) and riskCategory to "other"
    // — so this item legitimately may not clear the Geopolitical Risk
    // Tracker's relevance threshold. Recorded as informational, not scored
    // PASS/FAIL against the rest of the suite.
    console.log(`INFO[geopolitical-risk-tracker-shows-news-item]: ${geoRiskShowsItem ? "YES" : "NO (expected without ANTHROPIC_API_KEY — deterministic fallback yields 0 relevance)"}`);
    await shot("10b-geopolitical-risk-after");
  });

  // ===== FINAL REQUIRED SCREENSHOTS =====
  console.log("=== FINAL SCREENSHOTS ===");
  await section("mobile-dashboard", async () => {
    const mobileContext = await browser.newContext({ viewport: MOBILE });
    const mobilePage = await mobileContext.newPage();
    mobilePage.setDefaultTimeout(60000);
    await mobilePage.goto(`${baseUrl}/`, { waitUntil: "load", timeout: 60000 });
    await mobilePage.waitForTimeout(1800);
    await mobilePage.screenshot({ path: "15-mobile-dashboard.jpg", fullPage: true, type: "jpeg", quality: 45 });
    const mSize = fs.statSync("15-mobile-dashboard.jpg").size;
    const mB64 = fs.readFileSync("15-mobile-dashboard.jpg").toString("base64");
    console.log(`SHOT_CAPTURED: 15-mobile-dashboard bytes=${mSize} base64Length=${mB64.length}`);
    console.log("BEGIN_SHOT_B64:15-mobile-dashboard");
    console.log(mB64);
    console.log("END_SHOT_B64:15-mobile-dashboard");
    await mobileContext.close();
  });

  console.log("=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  const anyFail = results.some((r) => !r.pass);
  console.log(`OVERALL_UI_VERIFICATION: ${anyFail ? "SOME_CHECKS_FAILED" : "ALL_CHECKS_PASSED"}`);
} finally {
  await browser.close();
}
