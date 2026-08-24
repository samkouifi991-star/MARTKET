// One-off verification for the Top-Setups-vs-Market-Detail score
// synchronization fix, run against the REAL production Neon database from
// inside the Vercel build container (this project's dev sandbox cannot
// reach Neon/FMP/CFTC/FRED directly). For every STRICT_LIVE_SYMBOLS market:
//   1. computeLiveMarketScore(symbol, DATA_MODE, { persist: true }) — the
//      exact call the scores cron makes — computes a real score and
//      upserts it into current_market_scores/current_factor_scores.
//   2. getCurrentScore(symbol) — the exact call BOTH /markets/[symbol] and
//      /top-setups make — reads that row back.
// If every field the user's spec calls out (total score, bias, confidence,
// change24h, every factor contribution) matches between the two, Top
// Setups and Market Detail are provably reading the same canonical record
// in the real production database, not two independently-drifting values.
//
// Usage: npm run test:top-setups-sync-verify
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { getCurrentScore } from "../src/db/queries/scores";
import { DATA_MODE } from "../src/services/data-mode";
import { ScoreFactorKey } from "../src/lib/types";

const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

const FACTOR_KEYS: ScoreFactorKey[] = ["institutional", "retailSentiment", "technical", "seasonality", "economicGrowth", "inflation", "labor", "interestRates", "news"];

async function main() {
  if (DATA_MODE === "demo") {
    console.log("SYNC_VERIFY_RESULT: SKIPPED — DATA_MODE is demo in this build environment");
    return;
  }

  let passCount = 0;
  let failCount = 0;

  for (const symbol of STRICT_LIVE_SYMBOLS) {
    try {
      const computed = await computeLiveMarketScore(symbol, DATA_MODE, { persist: true });
      // upsertCurrentScore is fire-and-forget (best-effort) inside
      // computeLiveMarketScore — give it a moment to land before reading
      // back, so this isn't a false negative from a race, not a real bug.
      await new Promise((r) => setTimeout(r, 300));
      const read = await getCurrentScore(symbol);

      if (!read) {
        console.log(`SYNC_VERIFY_FAIL: ${symbol} — getCurrentScore returned null right after a persist:true compute`);
        failCount++;
        continue;
      }

      const mismatches: string[] = [];
      if (read.totalScore !== computed.totalScore) mismatches.push(`totalScore ${read.totalScore} != ${computed.totalScore}`);
      if (read.bias !== computed.bias) mismatches.push(`bias ${read.bias} != ${computed.bias}`);
      if (read.confidence !== computed.confidence) mismatches.push(`confidence ${read.confidence} != ${computed.confidence}`);
      if (read.change24h !== computed.change24h) mismatches.push(`change24h ${read.change24h} != ${computed.change24h}`);
      for (const key of FACTOR_KEYS) {
        const c = computed.factors.find((f) => f.key === key)!;
        const r = read.factors.find((f) => f.key === key);
        if (!r) {
          mismatches.push(`${key}: missing from current-score read`);
          continue;
        }
        if (r.contribution !== c.contribution) mismatches.push(`${key}.contribution ${r.contribution} != ${c.contribution}`);
        if (r.rawScore !== c.rawScore) mismatches.push(`${key}.rawScore ${r.rawScore} != ${c.rawScore}`);
      }

      if (mismatches.length === 0) {
        console.log(`SYNC_VERIFY_PASS: ${symbol} total=${computed.totalScore} bias=${computed.bias} confidence=${computed.confidence} change24h=${computed.change24h}`);
        passCount++;
      } else {
        console.log(`SYNC_VERIFY_FAIL: ${symbol} — ${mismatches.join("; ")}`);
        failCount++;
      }
    } catch (err) {
      console.log(`SYNC_VERIFY_FAIL: ${symbol} — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      failCount++;
    }
  }

  console.log(`SYNC_VERIFY_RESULT: ${failCount === 0 ? "SUCCESS" : "FAIL"} — ${passCount} passed, ${failCount} failed out of ${STRICT_LIVE_SYMBOLS.length}`);
}

main().catch((err) => console.log(`SYNC_VERIFY_RESULT: unexpected error ${err instanceof Error ? err.message : String(err)}`));
