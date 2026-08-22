// Top Setups' own real-score data source — deliberately separate from
// lib/market-data.ts's allMarketRows() (which stays demo-only, module-level
// cached, and is still legitimately used elsewhere — market-detail's cross-
// market correlation panel), so fixing Top Setups' score bug can't regress
// that unrelated consumer.
//
// The bug this exists to fix: allMarketRows() computed every score once
// with the DEMO generator (computeMarketScore) and cached it at module
// scope for the lifetime of the serverless instance — so Top Setups could
// show a totally different, stale number than /markets/[symbol].
//
// The fix reads the exact same canonical current_market_score row Market
// Detail now reads (see db/queries/scores.ts's getCurrentScore) — not a
// separate calculation that can drift, and not a live provider call either:
// this is a single SELECT per symbol against Neon, so refreshing Top Setups
// never multiplies this app's provider request volume. External providers
// stay the scheduled ingestion cron's job. Only a symbol with no current-
// score row yet (bootstrap: before the cron's first run or any Market
// Detail visit) falls back to a storage-only compute, and persists that as
// the bootstrap current row via updateCurrent so the next Top Setups read
// — and Market Detail's — finds the same row instead of recomputing again.
import { INSTRUMENTS } from "@/lib/instruments";
import { generatePriceData } from "@/lib/demo/price";
import { computeMarketScore } from "@/lib/scoring";
import { computeLiveMarketScore } from "./scoring-engine";
import { getCurrentScore } from "@/db/queries/scores";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { MarketRow } from "@/lib/market-data";

export async function getTopSetupsRows(): Promise<MarketRow[]> {
  if (isDemoOnly()) {
    return INSTRUMENTS.map((instrument) => ({
      instrument,
      price: generatePriceData(instrument),
      score: computeMarketScore(instrument),
    }));
  }

  return Promise.all(
    INSTRUMENTS.map(async (instrument) => ({
      instrument,
      // Price display is out of scope for this fix (not what was reported —
      // the demo score vs. real score mismatch was) and price isn't part of
      // the required Top-Setups-vs-Market-Detail parity check either; only
      // the score needs to be the real, canonical value here.
      price: generatePriceData(instrument),
      score:
        (await getCurrentScore(instrument.symbol).catch(() => null)) ??
        (await computeLiveMarketScore(instrument.symbol, DATA_MODE, { storageOnly: true, updateCurrent: true })),
    }))
  );
}
