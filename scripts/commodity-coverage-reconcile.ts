// Reconciles the "not yet seeded" read of COPPER/XPTUSD/WTIUSD/NATGAS
// against the earlier real-FMP finding that these four returned 402
// Payment Required — a read-only Neon check cannot tell "never tried" apart
// from "tried and blocked", so this makes exactly one real quote request
// and one real daily-history request per symbol, sequentially, and
// classifies each from the real HTTP response. Does NOT seed anything in
// this phase.
//
// Per-symbol classification:
//   READY         — both quote and daily history returned live data
//   BLOCKED_PLAN  — FMP returned 402 Payment Required for this ticker
//                   (structural plan-tier gap; that symbol is no longer
//                   treated as a seed candidate this run)
//   RATE_LIMITED  — FMP returned 429; STOPS the whole run immediately,
//                   remaining symbols are not attempted
//   ERROR         — some other genuine failure
//
// Only symbols classified READY here proceed to the second phase: Neon
// write + read-back + full computeLiveMarketScore("live") verification,
// reusing the exact quote/candles already fetched in phase one (so no
// symbol makes more than one quote request and one daily-history request
// total across both phases).
//
// Usage: npm run test:commodity-coverage-reconcile
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice, upsertCandles, getLatestStoredPrice, getLatestStoredDailyCandles } from "../src/db/queries/market-data";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { resolveSmartMoney } from "../src/lib/pipeline/positioning";
import { DATA_MODE } from "../src/services/data-mode";
import { NormalizedCandle, NormalizedQuote, Provenance } from "../src/services/types";

const SYMBOLS = ["COPPER", "XPTUSD", "WTIUSD", "NATGAS"] as const;
const HISTORY_DAYS = 20 * 365;

function log(msg: string): void {
  console.log(`COMMODITY_COVERAGE_RECONCILE: ${msg}`);
}

function isRateLimited(status: string, error?: string | null): boolean {
  return status === "unavailable" && !!error && /RATE_LIMITED|\b429\b/.test(error);
}
function isPlanLimited(status: string, error?: string | null): boolean {
  return status === "error" && !!error && /\b402\b/.test(error);
}
function httpStatusOf(p: Provenance<unknown>): string {
  if (p.status === "live") return "200";
  if (isRateLimited(p.status, p.error)) return "429";
  if (isPlanLimited(p.status, p.error)) return "402";
  const m = p.error?.match(/\b(\d{3})\b/);
  return m ? m[1] : "n/a";
}

type Classification = "READY" | "BLOCKED_PLAN" | "RATE_LIMITED" | "ERROR";

async function checkOne(symbol: string): Promise<{ classification: Classification; quote: Provenance<NormalizedQuote>; history: Provenance<NormalizedCandle[]> | null; httpStatus: string }> {
  const mapping = getSymbolMapping(symbol);
  log(`==== ${symbol} (FMP ticker: ${mapping?.fmp.ticker}) ====`);

  const quote = await fmp.getQuote(symbol);
  const quoteHttp = httpStatusOf(quote);
  log(`QUOTE status=${quote.status} httpStatus=${quoteHttp} price=${quote.value?.price ?? "n/a"} error=${quote.error ?? "none"}`);

  if (isRateLimited(quote.status, quote.error)) {
    return { classification: "RATE_LIMITED", quote, history: null, httpStatus: quoteHttp };
  }
  if (isPlanLimited(quote.status, quote.error)) {
    return { classification: "BLOCKED_PLAN", quote, history: null, httpStatus: quoteHttp };
  }
  if (quote.status !== "live" || !quote.value) {
    return { classification: "ERROR", quote, history: null, httpStatus: quoteHttp };
  }

  const history = await fmp.getDailyCandles(symbol, HISTORY_DAYS);
  const historyHttp = httpStatusOf(history);
  log(`DAILY_HISTORY status=${history.status} httpStatus=${historyHttp} count=${history.value?.length ?? 0} error=${history.error ?? "none"}`);

  if (isRateLimited(history.status, history.error)) {
    return { classification: "RATE_LIMITED", quote, history, httpStatus: historyHttp };
  }
  if (isPlanLimited(history.status, history.error)) {
    return { classification: "BLOCKED_PLAN", quote, history, httpStatus: historyHttp };
  }
  if (history.status !== "live" || !history.value || history.value.length === 0) {
    return { classification: "ERROR", quote, history, httpStatus: historyHttp };
  }

  return { classification: "READY", quote, history, httpStatus: "200" };
}

async function seedAndVerify(symbol: string, quote: Provenance<NormalizedQuote>, history: Provenance<NormalizedCandle[]>): Promise<void> {
  log(`---- ${symbol}: seeding + full pipeline verification (already-fetched real data, no extra requests) ----`);
  await upsertMarketPrice(symbol, quote.value!, "fmp");
  await upsertCandles(symbol, "1d", history.value!, "fmp");
  log(`NEON_WRITE ok (price + ${history.value!.length} daily candles)`);

  const storedPrice = await getLatestStoredPrice(symbol);
  const storedCandles = await getLatestStoredDailyCandles(symbol);
  const priceMatches = storedPrice?.price === quote.value!.price;
  const candleCountMatches = storedCandles?.candles.length === history.value!.length;
  log(`NEON_READBACK price=${storedPrice?.price} matches=${priceMatches} candleCount=${storedCandles?.candles.length} matches=${candleCountMatches}`);

  const score = await computeLiveMarketScore(symbol, "live");
  const smartMoney = await resolveSmartMoney(symbol);
  const byKey = Object.fromEntries(score.factors.map((f) => [f.key, f]));

  log(`TECHNICAL freshness=${byKey.technical.freshness} provider=${byKey.technical.provider} source="${byKey.technical.source}"`);
  log(`SEASONALITY freshness=${byKey.seasonality.freshness} explanation="${byKey.seasonality.explanation}"`);
  log(`INSTITUTIONAL(CFTC) freshness=${byKey.institutional.freshness} explanation="${byKey.institutional.explanation}"`);
  log(`MACRO(growth) freshness=${byKey.economicGrowth.freshness} explanation="${byKey.economicGrowth.explanation}"`);
  log(`RETAIL_SENTIMENT freshness=${byKey.retailSentiment.freshness} explanation="${byKey.retailSentiment.explanation}"`);
  log(`SMART_MONEY freshness=${smartMoney.freshness} signal=${smartMoney.signal}`);
  log(`SCORE totalScore=${score.totalScore} confidence=${score.confidence}`);

  const sumContributions = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  log(`CONTRIBUTION_SUM totalScore=${score.totalScore} sumContributions=${sumContributions} matches=${score.totalScore === sumContributions}`);
  const demoFactors = score.factors.filter((f) => f.freshness === "estimated" || f.source.includes("(demo)"));
  log(`DEMO_FALLBACK_CHECK usedDemo=${demoFactors.length > 0}`);
  log(`  full factor dump: ${JSON.stringify(score.factors.map((f) => ({ key: f.key, freshness: f.freshness, provider: f.provider, contribution: f.contribution })))}`);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  const rows: { symbol: string; classification: Classification; httpStatus: string }[] = [];
  const readyForSeed: { symbol: string; quote: Provenance<NormalizedQuote>; history: Provenance<NormalizedCandle[]> }[] = [];

  for (const symbol of SYMBOLS) {
    try {
      const { classification, quote, history, httpStatus } = await checkOne(symbol);
      rows.push({ symbol, classification, httpStatus });
      log(`${symbol} CLASSIFICATION: ${classification} (httpStatus=${httpStatus})`);

      if (classification === "RATE_LIMITED") {
        log(`STOPPED — FMP rate limit encountered at ${symbol}; remaining symbols not attempted.`);
        const remaining = SYMBOLS.slice(SYMBOLS.indexOf(symbol as (typeof SYMBOLS)[number]) + 1);
        for (const s of remaining) rows.push({ symbol: s, classification: "RATE_LIMITED", httpStatus: "n/a (not attempted)" });
        break;
      }
      if (classification === "READY" && history) {
        readyForSeed.push({ symbol, quote, history });
      }
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      rows.push({ symbol, classification: "ERROR", httpStatus: "n/a" });
    }
  }

  log(`COVERAGE_TABLE: ${JSON.stringify(rows)}`);

  if (readyForSeed.length === 0) {
    log("No symbol reached READY this run — nothing to seed. DONE.");
    return;
  }

  log(`Proceeding to seed + verify ${readyForSeed.length} READY symbol(s): ${readyForSeed.map((r) => r.symbol).join(", ")}`);
  for (const { symbol, quote, history } of readyForSeed) {
    try {
      await seedAndVerify(symbol, quote, history);
    } catch (err) {
      log(`${symbol} SEED/VERIFY FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE — nothing added to STRICT_LIVE_SYMBOLS by this script");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
