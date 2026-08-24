// Controlled real-FMP seed + full-pipeline verification for exactly the
// four requested non-FX candidates: RUT2000, FTSE100, NIKKEI225, ETHUSD.
// Does NOT touch any other unpromoted market, and does NOT add anything to
// STRICT_LIVE_SYMBOLS — this script only seeds real data and reports what
// the real pipeline does with it.
//
// Runs symbols STRICTLY SEQUENTIALLY (one at a time), never concurrently.
// For each symbol: real FMP quote -> real FMP full daily history -> Neon
// write -> Neon read-back -> full computeLiveMarketScore("live") pipeline
// run, matching FMP -> normalize -> Neon write -> Neon read-back -> factor
// pipeline verification exactly.
//
// Provider-response handling:
//   - A live FMP 429 (rate limit) on ANY request for ANY symbol stops the
//     whole run immediately. Remaining symbols are reported PENDING, not
//     attempted. No retries.
//   - A live FMP 402 (Payment Required) on the quote or full daily history
//     for a symbol means that market's core price/candle data is
//     structurally unavailable on this plan tier — that symbol is
//     classified BLOCKED (PLAN_LIMITATION) and the run moves on to the
//     next symbol (a 402 for one ticker says nothing about another).
//   - On success, the quote + daily candles are persisted to Neon and the
//     run proceeds to the real pipeline verification for that symbol.
//
// Usage: npm run test:four-market-seed-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice, upsertCandles, getLatestStoredPrice, getLatestStoredDailyCandles } from "../src/db/queries/market-data";
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { resolveSmartMoney } from "../src/lib/pipeline/positioning";
import { DATA_MODE } from "../src/services/data-mode";

const SYMBOLS = ["RUT2000", "FTSE100", "NIKKEI225", "ETHUSD"] as const;
const HISTORY_DAYS = 20 * 365; // request the fullest window FMP will return in one call

function log(msg: string): void {
  console.log(`FOUR_MARKET_SEED_VERIFY: ${msg}`);
}

function isRateLimited(status: string, error?: string | null): boolean {
  return status === "unavailable" && !!error && /RATE_LIMITED|\b429\b/.test(error);
}

// getQuote/getDailyCandles route a non-429 HTTP error through the generic
// errorResult() path (status "error"), whose message is the raw
// "FMP request failed: 402 Payment Required (...)" text — there is no
// dedicated PLAN_LIMITATION shape for these two calls the way
// getIntradayCandles has, so detect it from the message directly.
function isPlanLimited(status: string, error?: string | null): boolean {
  return status === "error" && !!error && /\b402\b/.test(error);
}

type Verdict = "READY" | "PARTIAL" | "BLOCKED" | "PENDING";

async function seedAndVerify(symbol: string): Promise<{ verdict: Verdict; rateLimitHit: boolean; row: Record<string, string> }> {
  log(`==== ${symbol} ====`);
  const row: Record<string, string> = { Market: symbol };

  // ---- 1. Real current quote ----
  const quote = await fmp.getQuote(symbol);
  log(`QUOTE status=${quote.status} provider=${quote.provider} price=${quote.value?.price} changePct24h=${quote.value?.changePct24h} timestamp=${quote.value?.timestamp} sourceUpdatedAt=${quote.sourceUpdatedAt} error=${quote.error ?? "none"}`);
  if (isRateLimited(quote.status, quote.error)) {
    log(`${symbol} — RATE LIMITED on quote. Stopping the entire run here.`);
    row.Quote = "RATE_LIMITED";
    return { verdict: "PENDING", rateLimitHit: true, row };
  }
  if (quote.status !== "live" || !quote.value) {
    if (isPlanLimited(quote.status, quote.error)) {
      log(`${symbol} — BLOCKED: quote returned 402 Payment Required (plan does not cover this ticker).`);
      row.Quote = "402 PLAN_LIMITATION";
      return { verdict: "BLOCKED", rateLimitHit: false, row };
    }
    log(`${symbol} — BLOCKED: quote failed (${quote.error ?? quote.status}), cannot seed without a real quote.`);
    row.Quote = `FAILED (${quote.error ?? quote.status})`;
    return { verdict: "BLOCKED", rateLimitHit: false, row };
  }
  row.Quote = `${quote.value.price} (live, ${quote.value.timestamp})`;

  // ---- 2. Full available daily history ----
  const history = await fmp.getDailyCandles(symbol, HISTORY_DAYS);
  const earliest = history.value?.[0]?.date;
  const latest = history.value?.[history.value.length - 1]?.date;
  log(`DAILY_HISTORY status=${history.status} count=${history.value?.length ?? 0} span=${earliest ?? "n/a"} to ${latest ?? "n/a"} error=${history.error ?? "none"}`);
  if (isRateLimited(history.status, history.error)) {
    log(`${symbol} — RATE LIMITED on daily history (quote already succeeded and is NOT persisted, to keep this symbol's Neon state consistent — price and candles are written together below). Stopping the entire run here.`);
    row.Quote += " — history rate-limited, not persisted";
    row["Stored Candles"] = "RATE_LIMITED";
    return { verdict: "PENDING", rateLimitHit: true, row };
  }
  if (history.status !== "live" || !history.value || history.value.length === 0) {
    if (isPlanLimited(history.status, history.error)) {
      log(`${symbol} — BLOCKED: daily history returned 402 Payment Required (plan does not cover this ticker).`);
      row["Stored Candles"] = "402 PLAN_LIMITATION";
      return { verdict: "BLOCKED", rateLimitHit: false, row };
    }
    log(`${symbol} — BLOCKED: daily history failed (${history.error ?? history.status}).`);
    row["Stored Candles"] = `FAILED (${history.error ?? history.status})`;
    return { verdict: "BLOCKED", rateLimitHit: false, row };
  }

  // ---- 3. Neon write ----
  await upsertMarketPrice(symbol, quote.value, "fmp");
  await upsertCandles(symbol, "1d", history.value, "fmp");
  log(`NEON_WRITE ok (price + ${history.value.length} daily candles)`);

  // ---- 4. Neon read-back ----
  const storedPrice = await getLatestStoredPrice(symbol);
  const storedCandles = await getLatestStoredDailyCandles(symbol);
  const priceMatches = storedPrice?.price === quote.value.price;
  const candleCountMatches = storedCandles?.candles.length === history.value.length;
  log(`NEON_READBACK price=${storedPrice?.price} matches=${priceMatches} candleCount=${storedCandles?.candles.length} matches=${candleCountMatches} provider=${storedCandles?.provider}`);
  row["Stored Candles"] = `${storedCandles?.candles.length ?? 0} (readback ${priceMatches && candleCountMatches ? "OK" : "MISMATCH"})`;
  row.History = `${earliest?.slice(0, 10)} to ${latest?.slice(0, 10)}`;

  // ---- 5. Full real pipeline (factor-by-factor + Smart Money, which is a
  // market-detail-only card, not one of the nine scored factors) ----
  const score = await computeLiveMarketScore(symbol, "live");
  const smartMoney = await resolveSmartMoney(symbol);

  const byKey = Object.fromEntries(score.factors.map((f) => [f.key, f]));
  const technical = byKey.technical;
  const seasonality = byKey.seasonality;
  const institutional = byKey.institutional;
  const retail = byKey.retailSentiment;
  const growth = byKey.economicGrowth;

  log(`TECHNICAL freshness=${technical.freshness} provider=${technical.provider} source="${technical.source}"`);
  log(`SEASONALITY freshness=${seasonality.freshness} provider=${seasonality.provider} explanation="${seasonality.explanation}"`);
  log(`INSTITUTIONAL(CFTC) freshness=${institutional.freshness} provider=${institutional.provider} explanation="${institutional.explanation}"`);
  log(`MACRO(growth) freshness=${growth.freshness} provider=${growth.provider} explanation="${growth.explanation}"`);
  log(`RETAIL_SENTIMENT freshness=${retail.freshness} provider=${retail.provider} explanation="${retail.explanation}"`);
  log(`SMART_MONEY freshness=${smartMoney.freshness} signal=${smartMoney.signal} explanation="${smartMoney.explanation}"`);
  log(`SCORE totalScore=${score.totalScore} confidence=${score.confidence}`);
  log(`  full factor dump: ${JSON.stringify(score.factors.map((f) => ({ key: f.key, freshness: f.freshness, provider: f.provider, contribution: f.contribution })))}`);

  const sumContributions = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  const sumMatches = score.totalScore === sumContributions;
  log(`CONTRIBUTION_SUM totalScore=${score.totalScore} sumContributions=${sumContributions} matches=${sumMatches}`);

  const demoFactors = score.factors.filter((f) => f.freshness === "estimated" || f.source.includes("(demo)"));
  log(`DEMO_FALLBACK_CHECK usedDemo=${demoFactors.length > 0} ${demoFactors.length ? `factors=${demoFactors.map((f) => f.key).join(",")}` : ""}`);

  // Any 429 encountered inside the pipeline run itself (technical's
  // default-window daily refetch, H4/H1, etc.) still means "stop before the
  // next symbol" even though this symbol's own seed already succeeded.
  const rateLimitedInPipeline = score.factors.some((f) => /RATE_LIMITED|\b429\b/.test(f.explanation) || /RATE_LIMITED|\b429\b/.test(f.source));

  row.Technical = `${technical.freshness}`;
  row.Seasonality = seasonality.freshness === "not_applicable" ? "not_applicable" : `${seasonality.freshness}`;
  row.CFTC = institutional.freshness;
  row.Macro = growth.freshness;
  row.Retail = retail.freshness;
  row.Score = `${score.totalScore}`;
  row.Confidence = `${score.confidence}`;

  // Real, working data end to end (even if some individual factor is
  // legitimately NOT_APPLICABLE by design) is READY; a factor genuinely
  // unavailable/error (not by-design NOT_APPLICABLE) is PARTIAL, never
  // silently upgraded to READY.
  const problemFactors = score.factors.filter((f) => f.freshness === "unavailable" || f.freshness === "error");
  const verdict: Verdict = problemFactors.length === 0 ? "READY" : "PARTIAL";
  if (problemFactors.length > 0) log(`PARTIAL — factor(s) genuinely unavailable/error (not NOT_APPLICABLE by design): ${problemFactors.map((f) => f.key).join(",")}`);

  return { verdict, rateLimitHit: rateLimitedInPipeline, row };
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  const rows: Record<string, string>[] = [];
  const verdicts: Record<string, Verdict> = {};

  for (const symbol of SYMBOLS) {
    try {
      const { verdict, rateLimitHit, row } = await seedAndVerify(symbol);
      verdicts[symbol] = verdict;
      rows.push(row);
      log(`${symbol} RESULT: ${verdict}`);
      if (rateLimitHit) {
        log(`STOPPED — FMP rate limit encountered while processing ${symbol}; not attempting remaining symbols this run.`);
        const remaining = SYMBOLS.slice(SYMBOLS.indexOf(symbol as (typeof SYMBOLS)[number]) + 1);
        for (const s of remaining) {
          verdicts[s] = "PENDING";
          rows.push({ Market: s, Quote: "PENDING", "Stored Candles": "PENDING" });
          log(`${s} RESULT: PENDING (not attempted)`);
        }
        break;
      }
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
      verdicts[symbol] = "BLOCKED";
      rows.push({ Market: symbol, Quote: "ERROR", "Stored Candles": "ERROR" });
    }
  }

  log(`FINAL_VERDICTS: ${JSON.stringify(verdicts)}`);
  log(`REPORT_ROWS: ${JSON.stringify(rows)}`);
  log("DONE — nothing added to STRICT_LIVE_SYMBOLS by this script");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
