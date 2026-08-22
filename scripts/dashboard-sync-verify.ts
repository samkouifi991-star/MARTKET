// One-off verification for the Dashboard synchronization fix, run against
// the REAL production Neon database from inside the Vercel build container
// (this project's dev sandbox cannot reach Neon directly). Confirms:
//   1. getAllCurrentScores() (the Dashboard's data source) returns a row for
//      every STRICT_LIVE_SYMBOLS market that computeLiveMarketScore has
//      already persisted a current score for.
//   2. getDashboardMarketRows() marks exactly those rows eligible for the
//      bullish/bearish rankings/counts, and marks every non-strict-live
//      ("blocked") instrument ineligible regardless of whether it has a row.
// This is a pure read — no live provider call, no new score computation.
//
// Usage: npm run test:dashboard-sync-verify
import { getAllCurrentScores } from "../src/db/queries/scores";
import { getDashboardMarketRows } from "../src/lib/pipeline/dashboard";
import { isStrictLiveSymbol, DATA_MODE } from "../src/services/data-mode";

const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

async function main() {
  if (DATA_MODE === "demo") {
    console.log("DASHBOARD_VERIFY_RESULT: SKIPPED — DATA_MODE is demo in this build environment");
    return;
  }

  let passCount = 0;
  let failCount = 0;

  const scores = await getAllCurrentScores();
  const rows = await getDashboardMarketRows();
  const byBias = { "Very Bullish": 0, "Bullish": 0, "Neutral": 0, "Bearish": 0, "Very Bearish": 0 } as Record<string, number>;

  for (const symbol of STRICT_LIVE_SYMBOLS) {
    const stored = scores.get(symbol);
    const row = rows.find((r) => r.instrument.symbol === symbol);
    if (!stored) {
      console.log(`DASHBOARD_VERIFY_FAIL: ${symbol} — no current-score row in Neon yet (run the scores cron first)`);
      failCount++;
      continue;
    }
    if (!row || !row.eligible || !row.score) {
      console.log(`DASHBOARD_VERIFY_FAIL: ${symbol} — getDashboardMarketRows did not mark it eligible despite a stored row`);
      failCount++;
      continue;
    }
    if (row.score.totalScore !== stored.totalScore || row.score.bias !== stored.bias || row.score.confidence !== stored.confidence) {
      console.log(`DASHBOARD_VERIFY_FAIL: ${symbol} — Dashboard row diverges from getAllCurrentScores (total ${row.score.totalScore} vs ${stored.totalScore})`);
      failCount++;
      continue;
    }
    byBias[stored.bias] = (byBias[stored.bias] ?? 0) + 1;
    console.log(`DASHBOARD_VERIFY_PASS: ${symbol} total=${stored.totalScore} bias=${stored.bias} confidence=${stored.confidence}`);
    passCount++;
  }

  for (const row of rows) {
    if (isStrictLiveSymbol(row.instrument.symbol)) continue;
    if (row.eligible) {
      console.log(`DASHBOARD_VERIFY_FAIL: ${row.instrument.symbol} — a non-strict-live (blocked) market was marked eligible for rankings`);
      failCount++;
    }
  }

  console.log(`DASHBOARD_VERIFY_COUNTS: veryBullish=${byBias["Very Bullish"]} veryBearish=${byBias["Very Bearish"]}`);
  console.log(`DASHBOARD_VERIFY_RESULT: ${failCount === 0 ? "SUCCESS" : "FAIL"} — ${passCount} passed, ${failCount} failed out of ${STRICT_LIVE_SYMBOLS.length}`);
}

main().catch((err) => console.log(`DASHBOARD_VERIFY_RESULT: unexpected error ${err instanceof Error ? err.message : String(err)}`));
