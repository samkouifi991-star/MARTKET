// Full scoring-pipeline dry run for the FX promotion candidates — runs the
// exact production computeLiveMarketScore() path (no persist) and reports
// every factor's freshness/provider/source, so promotion to
// STRICT_LIVE_SYMBOLS is decided from real end-to-end pipeline output, not
// just the individual provider checks done earlier.
//
// Usage: npm run test:fx-promotion-pipeline-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { DATA_MODE } from "../src/services/data-mode";

// USDCHF/NZDUSD/GBPJPY are the promotion candidates this run. EURGBP/EURJPY
// are included for visibility only (their EU macro coverage was just
// verified) — they are explicitly NOT being promoted this round, still
// held per the plan.
const SYMBOLS = ["USDCHF", "NZDUSD", "GBPJPY", "EURGBP", "EURJPY"];

function log(msg: string): void {
  console.log(`FX_PROMOTION_PIPELINE_VERIFY: ${msg}`);
}

async function verifyOne(symbol: string): Promise<void> {
  log(`==== ${symbol} ====`);
  const score = await computeLiveMarketScore(symbol, "live");
  log(`TOTAL_SCORE=${score.totalScore} CONFIDENCE=${score.confidence}`);
  for (const factor of score.factors) {
    log(`  ${factor.key}: freshness=${factor.freshness} provider=${factor.provider ?? "n/a"} contribution=${factor.contribution} source="${factor.source}"`);
  }
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  for (const symbol of SYMBOLS) {
    try {
      await verifyOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE — no market_scores row written (persist not set); promotion decision is manual after reviewing this output");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
