// Final promotion-gate verification for EURGBP/EURJPY, checked against the
// exact criteria list given before promoting them to STRICT_LIVE_SYMBOLS.
// Runs the real production code paths (oanda provider, market-data-router,
// each pipeline resolver, computeLiveMarketScore) in "live" mode — no mocks,
// no demo fallback possible (allowsDemoFallback requires mode==="hybrid").
//
// Usage: npm run test:eurgbp-eurjpy-promotion-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import * as oanda from "../src/services/market-data/oanda-market-data";
import * as marketData from "../src/services/market-data/market-data-router";
import { getLatestStoredDailyCandles } from "../src/db/queries/market-data";
import { resolveTechnicalFactor } from "../src/lib/pipeline/technical";
import { resolveSeasonalityFactor } from "../src/lib/pipeline/seasonality";
import { resolveRetailSentimentFactor } from "../src/lib/pipeline/sentiment";
import { resolveEconomicGrowthFactor } from "../src/lib/pipeline/macro";
import { resolveInstitutionalFactor, resolveSmartMoney } from "../src/lib/pipeline/positioning";
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { DATA_MODE } from "../src/services/data-mode";

const SYMBOLS = ["EURGBP", "EURJPY"] as const;
const EXPECTED_MACRO: Record<string, [string, string]> = { EURGBP: ["EUR", "GBP"], EURJPY: ["EUR", "JPY"] };

function log(msg: string): void {
  console.log(`EURGBP_EURJPY_PROMOTION_VERIFY: ${msg}`);
}

function check(label: string, pass: boolean, detail: string): boolean {
  log(`CRITERION [${pass ? "PASS" : "FAIL"}] ${label} — ${detail}`);
  return pass;
}

async function verifyOne(symbol: string): Promise<boolean> {
  log(`==== ${symbol} ====`);
  let allPass = true;

  // 1. OANDA quote LIVE
  const quote = await oanda.getQuote(symbol);
  allPass = check("OANDA quote LIVE", quote.status === "live" && quote.provider === "oanda", `status=${quote.status} provider=${quote.provider} price=${quote.value?.price}`) && allPass;

  // 2. Daily/H4/H1 candles available
  const daily = await marketData.getDailyCandles(symbol);
  const h4 = await marketData.getIntradayCandles(symbol, "4hour");
  const h1 = await marketData.getIntradayCandles(symbol, "1hour");
  allPass = check("Daily candles available", daily.status === "live" && daily.provider === "oanda" && (daily.value?.length ?? 0) > 0, `status=${daily.status} provider=${daily.provider} bars=${daily.value?.length ?? 0}`) && allPass;
  allPass = check("H4 candles available", h4.status === "live" && h4.provider === "oanda" && (h4.value?.length ?? 0) > 0, `status=${h4.status} provider=${h4.provider} bars=${h4.value?.length ?? 0}`) && allPass;
  allPass = check("H1 candles available", h1.status === "live" && h1.provider === "oanda" && (h1.value?.length ?? 0) > 0, `status=${h1.status} provider=${h1.provider} bars=${h1.value?.length ?? 0}`) && allPass;

  // 3. Stored Neon fallback available
  const stored = await getLatestStoredDailyCandles(symbol);
  allPass = check("Stored Neon fallback available", !!stored && stored.candles.length > 0, `storedCandles=${stored?.candles.length ?? 0} provider=${stored?.provider ?? "n/a"}`) && allPass;

  // 4. Technical Trend calculates
  const technical = await resolveTechnicalFactor(symbol, "live");
  allPass = check(
    "Technical Trend calculates",
    (technical.freshness === "live" || technical.freshness === "delayed") && technical.source.includes("OANDA D"),
    `freshness=${technical.freshness} provider=${technical.provider} source="${technical.source}"`
  ) && allPass;

  // 5. Seasonality has >10 years of real history
  const seasonality = await resolveSeasonalityFactor(symbol, "live");
  const yearsMatch = seasonality.explanation.match(/Sample covers ([\d.]+) years/);
  const years = yearsMatch ? Number(yearsMatch[1]) : 0;
  allPass = check(
    "Seasonality >10 years real history",
    (seasonality.freshness === "live" || seasonality.freshness === "delayed") && years > 10,
    `freshness=${seasonality.freshness} years=${years} explanation="${seasonality.explanation}"`
  ) && allPass;

  // 6. OANDA Retail Sentiment works
  const retail = await resolveRetailSentimentFactor(symbol, "live");
  allPass = check(
    "OANDA Retail Sentiment works",
    (retail.freshness === "live" || retail.freshness === "delayed" || retail.freshness === "stale") && retail.provider === "oanda",
    `freshness=${retail.freshness} provider=${retail.provider} source="${retail.source}"`
  ) && allPass;

  // 7. Macro pairing is correct (EU vs GB / EU vs JP)
  const growth = await resolveEconomicGrowthFactor(symbol, "live");
  const [base, quote2] = EXPECTED_MACRO[symbol];
  allPass = check(
    `Macro = ${base} vs ${quote2}`,
    growth.explanation.includes(`${base} `) && growth.explanation.includes(` ${quote2} `),
    `freshness=${growth.freshness} explanation="${growth.explanation}"`
  ) && allPass;

  // 8. Institutional Positioning = NOT_APPLICABLE
  const institutional = await resolveInstitutionalFactor(symbol, "live");
  allPass = check("Institutional Positioning = NOT_APPLICABLE", institutional.freshness === "not_applicable", `freshness=${institutional.freshness} explanation="${institutional.explanation}"`) && allPass;

  // 9. Smart Money does not fabricate CFTC positioning for the cross
  const smartMoney = await resolveSmartMoney(symbol);
  allPass = check(
    "Smart Money does not fabricate CFTC positioning",
    smartMoney.freshness === "not_applicable" && smartMoney.signal === "None",
    `freshness=${smartMoney.freshness} signal=${smartMoney.signal} explanation="${smartMoney.explanation}"`
  ) && allPass;

  // 10-12: full score — total equals visible weighted contributions,
  // confidence reflects stale/delayed macro, and no factor used demo fallback.
  const score = await computeLiveMarketScore(symbol, "live");
  const sumContributions = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  allPass = check("Final score equals sum of visible weighted contributions", score.totalScore === sumContributions, `totalScore=${score.totalScore} sumContributions=${sumContributions}`) && allPass;

  const nonLiveMacro = score.factors.filter((f) => ["economicGrowth", "inflation", "labor", "interestRates"].includes(f.key) && f.freshness !== "live" && f.freshness !== "not_applicable");
  allPass = check(
    "Confidence handles stale/delayed macro (not pinned at max)",
    score.confidence < 97 || nonLiveMacro.length === 0,
    `confidence=${score.confidence} nonLiveMacroFactors=${nonLiveMacro.map((f) => `${f.key}:${f.freshness}`).join(",") || "none"}`
  ) && allPass;

  const demoFactors = score.factors.filter((f) => f.freshness === "estimated" || f.source.includes("(demo)"));
  allPass = check("No demo fallback used", demoFactors.length === 0, demoFactors.length === 0 ? "no factor used demo/estimated data" : `demo factors: ${demoFactors.map((f) => f.key).join(",")}`) && allPass;

  log(`  full factor dump: ${JSON.stringify(score.factors.map((f) => ({ key: f.key, freshness: f.freshness, provider: f.provider, contribution: f.contribution })))}`);
  log(`${symbol} OVERALL: ${allPass ? "ALL CRITERIA PASS" : "SOME CRITERIA FAILED"} (totalScore=${score.totalScore} confidence=${score.confidence})`);
  return allPass;
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  let allPass = true;
  for (const symbol of SYMBOLS) {
    try {
      const pass = await verifyOne(symbol);
      allPass = pass && allPass;
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      allPass = false;
    }
  }

  log(`FINAL VERDICT: ${allPass ? "READY_FOR_PROMOTION" : "NOT_READY"}`);
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
