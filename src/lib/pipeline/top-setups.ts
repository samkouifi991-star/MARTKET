// The single canonical "every market, ranked" data source — read by Top
// Setups, Markets, Heatmap, Watchlists, and the landing page preview
// (getCanonicalMarketRows below), deliberately separate from
// lib/market-data.ts's allMarketRows() (which stays demo-only, module-level
// cached, and is still legitimately used elsewhere — market-detail's cross-
// market correlation panel), so fixing these pages' score/price bugs can't
// regress that unrelated consumer.
//
// Two bugs this exists to fix, both the same root cause (a page computing
// its own value instead of reading the one canonical record):
//   - Score: allMarketRows() computed every score once with the DEMO
//     generator (computeMarketScore) and cached it at module scope for the
//     lifetime of the serverless instance — so a page reading it could show
//     a totally different, stale number than /markets/[symbol].
//   - Price: even after the score fix, this file's own price field still
//     called lib/demo/price.ts's generatePriceData() — a deterministic but
//     entirely fake generator — regardless of DATA_MODE, so e.g. ETHUSD
//     could show 3,589.87 here while Market Detail's real, separately live-
//     fetched price showed 2,424.77.
//
// The fix: read the exact same canonical current_market_score row
// (db/queries/scores.ts's getCurrentScore) and canonical current price
// (price.ts's getCanonicalPriceCard, which itself only ever reads Neon —
// never a live provider call) that Market Detail reads. Every consumer of
// getCanonicalMarketRows() is therefore a pure ranked/grouped VIEW of the
// same records other pages read, never a separate calculation that can
// drift. External providers stay the scheduled ingestion crons' job.
//
// A symbol with no current-score row yet (bootstrap: before the cron's
// first run or any Market Detail visit) falls back to a storage-only
// compute, persisted as the bootstrap current row via updateCurrent so the
// next read here — and Market Detail's — finds the same row instead of
// recomputing again. A symbol with no canonical price row yet falls back to
// the demo price generator, honestly flagged via priceFreshness:
// "unavailable" (never "live"/"delayed"/"stale") rather than a live
// provider call — see price.ts's own allowsDemoFallback branch for why this
// is the same honesty rule used everywhere else in this pipeline, and why
// it should be rare in practice (the prices/candles crons already run on a
// schedule for every tracked instrument).
import { INSTRUMENTS } from "@/lib/instruments";
import { generatePriceData } from "@/lib/demo/price";
import { computeMarketScore } from "@/lib/scoring";
import { computeLiveMarketScore } from "./scoring-engine";
import { getCanonicalPriceCard } from "./price";
import { getCurrentScore } from "@/db/queries/scores";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { MarketRow } from "@/lib/market-data";

export async function getCanonicalMarketRows(): Promise<MarketRow[]> {
  if (isDemoOnly()) {
    return INSTRUMENTS.map((instrument) => ({
      instrument,
      price: generatePriceData(instrument),
      priceFreshness: "estimated",
      score: computeMarketScore(instrument),
    }));
  }

  return Promise.all(
    INSTRUMENTS.map(async (instrument) => {
      const [score, priceCard] = await Promise.all([
        (async () => (await getCurrentScore(instrument.symbol).catch(() => null)) ?? (await computeLiveMarketScore(instrument.symbol, DATA_MODE, { storageOnly: true, updateCurrent: true })))(),
        getCanonicalPriceCard(instrument.symbol, DATA_MODE),
      ]);
      return {
        instrument,
        price: priceCard.data ?? generatePriceData(instrument),
        priceFreshness: priceCard.data ? priceCard.freshness : "unavailable",
        score,
      };
    })
  );
}
