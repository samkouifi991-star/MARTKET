// Runs computeLiveMarketScore("GBPUSD") for real, confirming the full
// chain — real provider data -> stored in Neon -> read back -> factor
// calculated -> score stored -> readable — completes end to end. Needs an
// environment with real network access to FMP/CFTC/FRED/Neon (this
// project's dev sandbox cannot reach any of them directly), so this only
// produces a meaningful result run from Vercel or a machine with real
// internet access.
//
// Usage: npm run test:score-verify
import { computeLiveMarketScore } from "../src/lib/pipeline/scoring-engine";
import { DATA_MODE } from "../src/services/data-mode";

async function main() {
  if (DATA_MODE === "demo") {
    console.log("SCORE_ONEOFF_RESULT: SKIPPED — DATA_MODE is demo in this build environment");
    return;
  }
  try {
    const score = await computeLiveMarketScore("GBPUSD", DATA_MODE);
    console.log(
      `SCORE_ONEOFF_RESULT: SUCCESS total=${score.totalScore} bias=${score.bias} confidence=${score.confidence} factors=${score.factors.length}`
    );
    for (const f of score.factors) {
      console.log(`SCORE_ONEOFF_FACTOR: ${f.key} raw=${f.rawScore} weight=${f.weight} contribution=${f.contribution} freshness=${f.freshness} source="${f.source}"`);
    }
    const sumContribution = score.factors.reduce((s, f) => s + f.contribution, 0);
    console.log(`SCORE_ONEOFF_CHECK: sum(contributions)=${sumContribution.toFixed(4)} vs totalScore=${score.totalScore} match=${Math.abs(sumContribution - score.totalScore) < 0.01}`);
  } catch (err) {
    console.log(`SCORE_ONEOFF_RESULT: FAIL — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
}

main().catch((err) => console.log(`SCORE_ONEOFF_RESULT: unexpected error ${err instanceof Error ? err.message : String(err)}`));
