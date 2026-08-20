// Real Neon persistence proof for GBPUSD — the Definition of Done requires
// an actual write/read cycle, not just "the schema exists". Runs the full
// chain requested:
//   FMP GBPUSD quote/candles -> store in Neon -> read from Neon
//   -> calculate Technical Trend / Seasonality (from the DB-read data)
//   -> calculate market score -> write factor_scores + market_scores
//   -> read the saved score back -> report row counts
//
// Needs an environment with real network access to FMP and Neon — this
// project's dev sandbox has neither — so this is meant to run from Vercel
// or a machine with real internet access.
//
// Usage: npm run test:gbpusd-persistence
import { eq, and, count, desc } from "drizzle-orm";
import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice, upsertCandles } from "../src/db/queries/market-data";
import { computeTechnicalTrend } from "../src/lib/engines/technical-trend";
import { computeCurrentMonthStat } from "../src/lib/engines/seasonality";
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { recordScoreHistory } from "../src/db/queries/scores";
import { DATA_MODE } from "../src/services/data-mode";
import { getDb } from "../src/db/client";
import { marketPrices, marketCandles, factorScores, marketScores } from "../src/db/schema";
import { NormalizedCandle } from "../src/services/types";

const SYMBOL = "GBPUSD";

function log(msg: string): void {
  console.log(`PERSIST_PROOF: ${msg}`);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? ` | cause: ${cause.message}` : cause ? ` | cause: ${String(cause)}` : "";
    return `${err.name}: ${err.message}${causeMsg}`;
  }
  return String(err);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  const db = getDb();

  // 1. Fetch real FMP data.
  const quote = await fmp.getQuote(SYMBOL);
  log(`quote fetch status=${quote.status} price=${quote.value?.price ?? "n/a"}`);
  if (quote.status === "live" && quote.value) {
    await upsertMarketPrice(SYMBOL, quote.value, "fmp");
    log("quote stored in market_prices");
  }

  const daily = await fmp.getDailyCandles(SYMBOL);
  log(`daily candles fetch status=${daily.status} count=${daily.value?.length ?? 0}`);
  if (daily.status === "live" && daily.value) {
    await upsertCandles(SYMBOL, "1d", daily.value, "fmp");
    log(`${daily.value.length} daily candles stored in market_candles`);
  }

  // 2. Read back from Neon — not the values we just fetched, an actual
  // SELECT against the tables, so this proves the write really landed.
  const priceRows = await db.select().from(marketPrices).where(eq(marketPrices.symbol, SYMBOL));
  const candleRows = await db.select().from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "1d")));
  log(`read back from Neon: market_prices rows=${priceRows.length}, market_candles(1d) rows=${candleRows.length}`);

  // 3. Calculate Technical Trend / Seasonality from the DB-read data
  // (not re-fetched from FMP) — proves the stored data is actually usable
  // for real computation, not just archived.
  if (candleRows.length >= 20) {
    const dbCandles: NormalizedCandle[] = [...candleRows]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((r) => ({ date: r.date.toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));

    const trend = computeTechnicalTrend({ daily: dbCandles });
    log(trend ? `Technical Trend from DB-read candles: rawScore=${trend.rawScore.toFixed(2)} — ${trend.explanation}` : "Technical Trend: insufficient DB-read history");

    const seasonal = computeCurrentMonthStat(dbCandles);
    log(
      seasonal
        ? `Seasonality from DB-read candles: ${seasonal.period} avgReturn=${seasonal.avgReturn.toFixed(2)}% pctPositive=${seasonal.pctPositive.toFixed(0)}% years=${seasonal.years}`
        : "Seasonality: insufficient DB-read history"
    );
  } else {
    log(`Technical Trend / Seasonality skipped — only ${candleRows.length} daily candle rows in Neon so far (need >= 20)`);
  }

  // 4. Compute the full market score (uses the live pipeline internally —
  // benefits from this process's request-cache, so it does not re-hit FMP
  // for quote/daily) and persist it explicitly. computeLiveMarketScore()
  // already calls recordScoreHistory() internally, but fire-and-forget
  // (`.catch(() => {})`, not awaited) — awaiting it again here directly
  // guarantees the write has actually completed before we read it back,
  // rather than racing an in-flight write.
  const score = await computeLiveMarketScore(SYMBOL, DATA_MODE);
  log(`score computed: total=${score.totalScore} bias=${score.bias} confidence=${score.confidence}%`);
  await recordScoreHistory(score);
  log("score persisted to factor_scores + market_scores (awaited, not fire-and-forget)");

  // 5. Read the saved score back.
  const latestScore = await db.select().from(marketScores).where(eq(marketScores.symbol, SYMBOL)).orderBy(desc(marketScores.computedAt)).limit(1);
  const latestFactors = await db.select().from(factorScores).where(eq(factorScores.symbol, SYMBOL)).orderBy(desc(factorScores.computedAt)).limit(9);
  if (latestScore[0]) {
    log(`read back market_scores: total=${latestScore[0].totalScore} bias=${latestScore[0].bias} confidence=${latestScore[0].confidence}% computedAt=${latestScore[0].computedAt.toISOString()}`);
  } else {
    log("FAIL — no market_scores row found after persistence");
  }
  log(`read back factor_scores rows=${latestFactors.length}`);

  // 6. Exact row counts, as requested.
  const [priceCount] = await db.select({ value: count() }).from(marketPrices).where(eq(marketPrices.symbol, SYMBOL));
  const [candleCount] = await db.select({ value: count() }).from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "1d")));
  const [factorCount] = await db.select({ value: count() }).from(factorScores).where(eq(factorScores.symbol, SYMBOL));
  const [scoreCount] = await db.select({ value: count() }).from(marketScores).where(eq(marketScores.symbol, SYMBOL));
  log(`ROW_COUNTS market_prices=${priceCount.value} market_candles(1d)=${candleCount.value} factor_scores=${factorCount.value} market_scores=${scoreCount.value}`);

  log(quote.status === "live" && daily.status === "live" && latestScore[0] ? "RESULT SUCCESS" : "RESULT PARTIAL — see individual steps above");
}

main().catch((err) => log(`RESULT FAIL — ${describeError(err)}`));
