// Historical reliability backtest for Scoring Engine V2 (requirement #20).
//
// Reads REAL stored factorScoresV2 history and REAL stored daily candles
// for every strict-live market, and reports forward-return statistics
// (hit rate, directional accuracy, average return, max drawdown, sample
// size) at 1/3/5/10/20 trading days — for each of V2's 9 real factors
// individually, one natural macro combination (inflation + interest rates
// + economic growth), and cycles where an event shock actually fired.
//
// This produces NO real conclusions yet. reliability.ts's MIN_SAMPLE_SIZE
// (30) is the honest bar for treating any of this as more than noise, and
// V2 has only just started accumulating real shadow-mode history — expect
// n=0 or very small sample sizes on an early run of this script. Every
// number reported is real (computed from real stored data, never
// fabricated); it's simply based on very little history today. Re-run
// periodically as shadow data accumulates. This script does not write
// anything back into the engine — a human reviews these numbers before any
// promotion decision.
//
// Usage:
//   DATABASE_URL=... npm run backtest:v2-factors
// or place DATABASE_URL in .env.local and just run: npm run backtest:v2-factors
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { strictLiveSymbolList } from "../src/services/data-mode";
import { getFactorScoreV2History } from "../src/db/queries/scoring-v2";
import { getLatestStoredDailyCandles } from "../src/db/queries/market-data";
import { BacktestStat, CandleClose, combinedSignal, factorSignal, hadEventShock, runBacktest } from "../src/lib/scoring-v2/backtest";
import { ScoreFactorKey } from "../src/lib/types";

const FACTOR_KEYS: ScoreFactorKey[] = [
  "technical",
  "seasonality",
  "institutional",
  "retailSentiment",
  "economicGrowth",
  "inflation",
  "labor",
  "interestRates",
  "news",
];

const MIN_SAMPLE_SIZE = 30; // mirrors reliability.ts's honest bar for "meaningful"

function formatStat(s: BacktestStat): string {
  if (s.sampleSize === 0) return `${s.horizonDays}d: n=0`;
  const hit = s.hitRate !== null ? `${s.hitRate}%` : "n/a";
  return `${s.horizonDays}d: n=${s.sampleSize} hit=${hit} dirAcc=${s.directionalAccuracy}% avgRet=${(s.avgReturn! * 100).toFixed(2)}% maxDD=${(s.maxDrawdown! * 100).toFixed(2)}%`;
}

async function runForSymbol(symbol: string): Promise<number> {
  const [history, storedCandles] = await Promise.all([getFactorScoreV2History(symbol), getLatestStoredDailyCandles(symbol)]);

  if (history.length === 0) {
    console.log(`\n${symbol}: no V2 factor-score history yet.`);
    return 0;
  }
  if (!storedCandles || storedCandles.candles.length === 0) {
    console.log(`\n${symbol}: no stored daily candles yet — can't compute forward returns.`);
    return 0;
  }

  const candles: CandleClose[] = storedCandles.candles.map((c) => ({ date: c.date.slice(0, 10), close: c.close }));

  console.log(`\n${symbol} (${history.length} V2 score-days, ${candles.length} stored daily candles)`);

  let maxSampleSize = 0;
  for (const key of FACTOR_KEYS) {
    const result = runBacktest(history, candles, key, (p) => factorSignal(p, key));
    maxSampleSize = Math.max(maxSampleSize, ...result.stats.map((s) => s.sampleSize));
    console.log(`  ${key.padEnd(16)} ${result.stats.map(formatStat).join(" | ")}`);
  }

  const macroComposite = runBacktest(history, candles, "macro composite", (p) => combinedSignal(p, ["inflation", "interestRates", "economicGrowth"]));
  maxSampleSize = Math.max(maxSampleSize, ...macroComposite.stats.map((s) => s.sampleSize));
  console.log(`  ${macroComposite.label.padEnd(16)} ${macroComposite.stats.map(formatStat).join(" | ")}`);

  const eventCycles = runBacktest(history, candles, "event-shock cycles", (p) => p.factors.reduce((s, f) => s + f.contribution, 0), hadEventShock);
  console.log(`  ${eventCycles.label.padEnd(16)} ${eventCycles.stats.map(formatStat).join(" | ")}`);

  return maxSampleSize;
}

async function run() {
  const symbols = strictLiveSymbolList();
  console.log(`Backtesting Scoring Engine V2 factors across ${symbols.length} strict-live markets (horizons: 1/3/5/10/20 trading days).`);
  console.log(`NOTE: reliability.ts requires at least ${MIN_SAMPLE_SIZE} samples before treating any factor as more than noise.\n`);

  let largestSampleSeen = 0;
  for (const symbol of symbols) {
    largestSampleSeen = Math.max(largestSampleSeen, await runForSymbol(symbol));
  }

  console.log(
    largestSampleSeen < MIN_SAMPLE_SIZE
      ? `\nNo factor/horizon combination reached ${MIN_SAMPLE_SIZE} samples yet (largest seen: ${largestSampleSeen}). These are real numbers from real, very early shadow-mode data — not yet a meaningful reliability signal. Re-run this script after V2 has accumulated more history.`
      : `\nAt least one factor/horizon combination has reached the ${MIN_SAMPLE_SIZE}-sample bar. Review the numbers above carefully before drawing any conclusion — this script does not decide anything on its own.`
  );
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
