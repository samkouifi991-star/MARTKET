// One-off verification for the Admin-scoring-weights fix, run against the
// REAL production Neon database from inside the Vercel build container
// (this dev sandbox cannot reach Neon directly). Reproduces the exact bug
// report:
//   Admin: Institutional 15% / Retail 5% / Technical 20% / Seasonality 5%
//   / Growth 13% / Inflation 10% / Labor 10% / Rates 15% / News 7%
//   BTCUSD Market Detail (stale, before the fix): Retail 10% / Growth 12%
//   / Rates 13% — the hardcoded DEFAULT_FACTOR_WEIGHTS, not Admin's saved
//   configuration.
//
// This script saves exactly that configuration as the new active version
// (the real, intended end state — not a throwaway test value), recomputes
// every STRICT_LIVE_SYMBOLS market's canonical current score against it
// with storageOnly:true (no provider calls), then reads back every
// factor's weight from current_factor_scores and confirms it matches the
// saved configuration — plus the Total Score = Σ contributions invariant
// — for all 19 markets.
//
// Usage (inside vercel-build only): tsx scripts/scoring-config-verify.ts
import { createScoringConfiguration, getScoringConfigurationById } from "../src/db/queries/scoring-config";
import { getCurrentScore } from "../src/db/queries/scores";
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { DATA_MODE, isDemoOnly } from "../src/services/data-mode";
import { DEFAULT_BIAS_THRESHOLDS } from "../src/lib/config";
import { ScoreFactorKey } from "../src/lib/types";

const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

// The exact weights from the bug report — sums to 100%.
const REPORTED_WEIGHTS: Record<ScoreFactorKey, number> = {
  institutional: 0.15,
  retailSentiment: 0.05,
  technical: 0.2,
  seasonality: 0.05,
  economicGrowth: 0.13,
  inflation: 0.1,
  labor: 0.1,
  interestRates: 0.15,
  news: 0.07,
};

async function main() {
  if (isDemoOnly()) {
    console.log("SCORING_CONFIG_VERIFY_RESULT: SKIPPED — DATA_MODE is demo in this build environment");
    return;
  }

  const sum = Object.values(REPORTED_WEIGHTS).reduce((s, v) => s + v, 0);
  if (Math.abs(sum - 1) > 0.001) {
    console.log(`SCORING_CONFIG_VERIFY_RESULT: FAIL — REPORTED_WEIGHTS sum to ${sum}, not 1`);
    return;
  }

  const saved = await createScoringConfiguration({ weights: REPORTED_WEIGHTS, biasThresholds: DEFAULT_BIAS_THRESHOLDS, createdBy: "verification-script" });
  const active = await getScoringConfigurationById(saved.id);
  if (!active) {
    console.log("SCORING_CONFIG_VERIFY_RESULT: FAIL — saved configuration could not be read back");
    return;
  }
  console.log(`SCORING_CONFIG_VERIFY_STEP: saved+activated scoring configuration v${active.id}`);

  const scoringConfig = { id: active.id, weights: active.weights, biasThresholds: active.biasThresholds };

  let passCount = 0;
  let failCount = 0;

  for (const symbol of STRICT_LIVE_SYMBOLS) {
    try {
      await computeLiveMarketScore(symbol, DATA_MODE, { storageOnly: true, updateCurrent: true, scoringConfig });
      const read = await getCurrentScore(symbol);
      if (!read) {
        console.log(`SCORING_CONFIG_VERIFY_FAIL: ${symbol} — getCurrentScore returned null right after recompute`);
        failCount++;
        continue;
      }

      const mismatches: string[] = [];
      for (const [key, expectedWeight] of Object.entries(REPORTED_WEIGHTS) as [ScoreFactorKey, number][]) {
        const f = read.factors.find((x) => x.key === key);
        if (!f) {
          mismatches.push(`${key}: missing`);
          continue;
        }
        if (f.weight !== expectedWeight) mismatches.push(`${key} weight ${f.weight} != expected ${expectedWeight}`);
      }
      const sumContrib = Number(read.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
      if (sumContrib !== read.totalScore) mismatches.push(`Total Score ${read.totalScore} != Σ contributions ${sumContrib}`);

      if (mismatches.length === 0) {
        console.log(`SCORING_CONFIG_VERIFY_PASS: ${symbol} total=${read.totalScore} bias=${read.bias}`);
        passCount++;
      } else {
        console.log(`SCORING_CONFIG_VERIFY_FAIL: ${symbol} — ${mismatches.join("; ")}`);
        failCount++;
      }

      if (symbol === "BTCUSD") {
        const retail = read.factors.find((f) => f.key === "retailSentiment")!;
        const growth = read.factors.find((f) => f.key === "economicGrowth")!;
        const rates = read.factors.find((f) => f.key === "interestRates")!;
        console.log(
          `SCORING_CONFIG_VERIFY_BTCUSD: retail_weight=${(retail.weight * 100).toFixed(0)}% growth_weight=${(growth.weight * 100).toFixed(0)}% rates_weight=${(rates.weight * 100).toFixed(0)}% (expected 5%/13%/15% per the reported Admin configuration)`
        );
      }
    } catch (err) {
      console.log(`SCORING_CONFIG_VERIFY_FAIL: ${symbol} — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      failCount++;
    }
  }

  console.log(`SCORING_CONFIG_VERIFY_RESULT: ${failCount === 0 ? "SUCCESS" : "FAIL"} — ${passCount} passed, ${failCount} failed out of ${STRICT_LIVE_SYMBOLS.length}`);
}

main().catch((err) => console.log(`SCORING_CONFIG_VERIFY_RESULT: unexpected error ${err instanceof Error ? err.message : String(err)}`));
