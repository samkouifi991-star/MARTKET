// Phase 14 — Final QA screenshot + data-extraction run against real
// production. Only hits routes reachable WITHOUT a login session: the
// bearer-secret-gated /diagnostics/scorecard/[symbol] route (renders the
// exact same Scorecard component a real customer sees) and the genuinely
// public marketing routes (proxy.ts's PUBLIC_EXACT/PUBLIC_PREFIXES). Every
// auth-gated page (Dashboard, Scorecard selector, Top Setups, Institutional
// Positioning, Retail Sentiment, News, Admin Economic Coverage, etc.) is
// deliberately out of scope this pass — no login credentials were
// available — and is reported as "not independently verified" rather than
// guessed at.
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.APP_BASE_URL;
const KEY = process.env.EVENT_WATCH_SECRET;

const SCORECARD_SYMBOLS = ["AUDUSD", "USDJPY", "GBPJPY", "EURGBP", "XAUUSD", "SPX500", "BTCUSD"];
const FX_PAIRS = new Set(["AUDUSD", "USDJPY", "GBPJPY", "EURGBP"]);

const results = { scorecards: {}, publicPages: {}, errors: [] };

function scorecardUrl(symbol) {
  return `${BASE}/diagnostics/scorecard/${symbol}?key=${encodeURIComponent(KEY)}`;
}

function attachListeners(page, bucket) {
  bucket.console = [];
  bucket.pageErrors = [];
  bucket.failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      bucket.console.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => bucket.pageErrors.push(String(err)));
  page.on("response", (res) => {
    if (res.status() >= 400) {
      bucket.failedRequests.push({ url: res.url(), status: res.status() });
    }
  });
}

async function extractScorecardJson(page) {
  try {
    const text = await page.$eval("details pre", (el) => el.textContent);
    return JSON.parse(text);
  } catch (e) {
    return { __extractError: String(e) };
  }
}

async function checkSectionOrder(page) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,[class*='title'],div"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    const whyIdx = headings.findIndex((t) => t === "Why This Score?");
    const historyIdx = headings.findIndex((t) => t === "Price & Intelligence History");
    return { whyIdx, historyIdx, orderCorrect: whyIdx !== -1 && historyIdx !== -1 && whyIdx < historyIdx };
  });
}

async function checkBannedWording(page) {
  const bodyText = await page.evaluate(() => document.body.innerText);
  return {
    hasOldForexScorecardWording: /\bForex Scorecard\b/.test(bodyText),
    hasScoreHistoryQuickView: /Score History Quick View/i.test(bodyText),
    hasScoreTrackingBegan: /Score tracking began/i.test(bodyText),
  };
}

(async () => {
  if (!BASE || !KEY) {
    console.error("APP_BASE_URL or EVENT_WATCH_SECRET not set");
    process.exit(1);
  }
  fs.mkdirSync("shots", { recursive: true });

  const browser = await chromium.launch();

  // ---- Desktop: scorecards ----
  for (const symbol of SCORECARD_SYMBOLS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const bucket = {};
    attachListeners(page, bucket);
    const url = scorecardUrl(symbol);
    console.log(`Loading ${symbol} (desktop)...`);
    let httpStatus = null;
    try {
      const resp = await page.goto(url, { waitUntil: "load", timeout: 60000 });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(1500);
    } catch (e) {
      bucket.navError = String(e);
    }
    await page.screenshot({ path: `shots/${symbol}-desktop-top.png`, fullPage: false }).catch(() => {});
    await page.screenshot({ path: `shots/${symbol}-desktop-full.png`, fullPage: true }).catch(() => {});

    const json = await extractScorecardJson(page);
    const wording = await checkBannedWording(page);
    const sectionOrder = await checkSectionOrder(page);

    if (FX_PAIRS.has(symbol)) {
      await page.evaluate(() => document.getElementById("sc-macro")?.scrollIntoView());
      await page.waitForTimeout(500);
      await page.screenshot({ path: `shots/${symbol}-macro.png`, fullPage: false }).catch(() => {});
    }
    if (symbol === "XAUUSD") {
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("*")).find((e) => e.textContent?.trim() === "Price & Intelligence History");
        el?.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `shots/${symbol}-price-history.png`, fullPage: false }).catch(() => {});
    }

    results.scorecards[symbol] = { httpStatus, json, wording, sectionOrder, ...bucket };
    await page.close();
  }

  // ---- Mobile: one scorecard + landing page ----
  const iphone = { width: 390, height: 844 };
  {
    const page = await browser.newPage({ viewport: iphone });
    const bucket = {};
    attachListeners(page, bucket);
    console.log("Loading AUDUSD (mobile)...");
    let httpStatus = null;
    try {
      const resp = await page.goto(scorecardUrl("AUDUSD"), { waitUntil: "load", timeout: 60000 });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(1500);
    } catch (e) {
      bucket.navError = String(e);
    }
    await page.screenshot({ path: `shots/AUDUSD-mobile-top.png`, fullPage: false }).catch(() => {});
    await page.screenshot({ path: `shots/AUDUSD-mobile-full.png`, fullPage: true }).catch(() => {});
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    results.mobileScorecard = { httpStatus, hasHorizontalOverflow, ...bucket };
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: iphone });
    const bucket = {};
    attachListeners(page, bucket);
    console.log("Loading landing page (mobile) — Dashboard is auth-gated, this is the closest reachable substitute...");
    let httpStatus = null;
    try {
      const resp = await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(1000);
    } catch (e) {
      bucket.navError = String(e);
    }
    await page.screenshot({ path: `shots/landing-mobile.png`, fullPage: true }).catch(() => {});
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    results.mobileLanding = { httpStatus, hasHorizontalOverflow, ...bucket };
    await page.close();
  }

  // ---- Public pages (desktop) ----
  for (const [name, path] of [
    ["landing", "/"],
    ["features", "/features"],
    ["pricing", "/pricing"],
    ["signin", "/signin"],
    ["signup", "/signup"],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const bucket = {};
    attachListeners(page, bucket);
    console.log(`Loading ${name}...`);
    let httpStatus = null;
    try {
      const resp = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 });
      httpStatus = resp ? resp.status() : null;
      await page.waitForTimeout(800);
    } catch (e) {
      bucket.navError = String(e);
    }
    await page.screenshot({ path: `shots/public-${name}.png`, fullPage: true }).catch(() => {});
    const wording = await checkBannedWording(page);
    results.publicPages[name] = { httpStatus, wording, ...bucket };
    await page.close();
  }

  await browser.close();
  fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
  console.log("DONE");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
