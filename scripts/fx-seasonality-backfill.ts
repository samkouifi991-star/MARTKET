// Canonical, one-time FX Seasonality history backfill — NOT wired into
// vercel-build or any page request (run it manually, once per market, via
// the controlled deploy pattern this project uses for every one-off
// script). Scoped to the 10 configured FX pairs only.
//
// Canonical history policy for this script:
//   1. Preserve valid existing historical candles — a symbol already
//      holding at least SUFFICIENT_CANDLES stored daily rows (currently
//      2500, ~10 years — Seasonality's own "live" confidence tier, see
//      seasonalityDepthFreshness in pipeline/types.ts) is left untouched.
//      This is deliberate: GBPUSD/EURUSD/USDJPY/AUDUSD/USDCAD already carry
//      real, long FMP history from earlier batches — this script must never
//      blindly overwrite that with OANDA data just because OANDA is now
//      primary for FX.
//   2. Backfill only genuinely-insufficient symbols, from OANDA's max-depth
//      single-request cap (~18-20y, 5000 candles) via the router's
//      getDailyCandlesBackfill (OANDA for FX, matching the new priority).
//   3. Prevent duplicate timestamps: upsertCandles already conflicts on
//      (symbol, timeframe, date), so re-running this script is always safe
//      (idempotent) — a backfilled symbol re-run here just re-upserts the
//      same rows.
//   4. Retain provider provenance: every written row is tagged with the
//      REAL provider the data came from (candles.provider, e.g. "oanda"),
//      never a hardcoded string.
// Deliberately does NOT attempt to "merge missing ranges" within an
// already-sufficient symbol's existing history — mixing two providers'
// candles for the same symbol risks subtly different OHLC values for
// overlapping dates; that's future work if it's ever actually needed, not
// assumed safe today.
//
// Usage: npm run test:fx-seasonality-backfill
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import * as marketData from "../src/services/market-data/market-data-router";
import { getLatestStoredDailyCandles, upsertCandles } from "../src/db/queries/market-data";
import { DATA_MODE } from "../src/services/data-mode";

const FX_PAIRS = ["GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"];
const SUFFICIENT_CANDLES = 2500; // ~10 years of daily bars — Seasonality's own "live" confidence tier

function log(msg: string): void {
  console.log(`FX_SEASONALITY_BACKFILL: ${msg}`);
}

async function backfillOne(symbol: string): Promise<void> {
  const existing = await getLatestStoredDailyCandles(symbol);
  const existingCount = existing?.candles.length ?? 0;

  if (existingCount >= SUFFICIENT_CANDLES) {
    log(`${symbol} SKIPPED — already has ${existingCount} stored daily candles (provider=${existing!.provider}), at or above the ${SUFFICIENT_CANDLES}-candle sufficiency threshold. Not overwritten.`);
    return;
  }

  log(`${symbol} needs backfill — only ${existingCount} stored daily candles currently. Fetching max-depth history...`);
  const backfill = await marketData.getDailyCandlesBackfill(symbol);
  if (backfill.status !== "live" || !backfill.value || backfill.value.length === 0) {
    log(`${symbol} FAILED — backfill fetch unavailable (${backfill.error ?? backfill.status})`);
    return;
  }

  await upsertCandles(symbol, "1d", backfill.value, backfill.provider);
  const after = await getLatestStoredDailyCandles(symbol);
  log(`${symbol} BACKFILLED — wrote ${backfill.value.length} candles from ${backfill.provider}, span ${backfill.value[0].date} .. ${backfill.value[backfill.value.length - 1].date}. Now ${after?.candles.length ?? 0} stored.`);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  for (const symbol of FX_PAIRS) {
    try {
      await backfillOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
