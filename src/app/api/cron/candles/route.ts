// Historical candles (daily + intraday) — refreshed after new bars close.
// Runs once daily for the daily timeframe and is safe to run more often for
// intraday, since upsertCandles dedupes on (symbol, timeframe, date).
// Routed through market-data-router.ts (OANDA primary for the 10 configured
// FX pairs, FMP primary for everything else) so this cron never hardcodes a
// provider — upsertCandles always stores the real provider the router
// returned, per symbol.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import * as marketData from "@/services/market-data/market-data-router";
import { upsertCandles } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.map((i) => i.symbol);

  // Health-tracking keys stay "fmp:daily"/"fmp:4h"/"fmp:1h" (unchanged) —
  // gbpusd-validation.ts's admin page reads provider_health by these exact
  // literal keys; they name each candle job, not literally "always FMP"
  // (the jobs themselves now route per-symbol). Keyed per dataset (not a
  // shared row) so the admin page shows daily/4H/1H status independently.
  const daily = await runJobForEachSymbol("fmp:daily", symbols, async (symbol) => {
    const candles = await marketData.getDailyCandles(symbol, 20 * 365);
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "daily candles unavailable");
    await upsertCandles(symbol, "1d", candles.value, candles.provider);
  });

  const h4 = await runJobForEachSymbol("fmp:4h", symbols, async (symbol) => {
    const candles = await marketData.getIntradayCandles(symbol, "4hour");
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "4H candles unavailable");
    await upsertCandles(symbol, "4h", candles.value, candles.provider);
  });

  const h1 = await runJobForEachSymbol("fmp:1h", symbols, async (symbol) => {
    const candles = await marketData.getIntradayCandles(symbol, "1hour");
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "1H candles unavailable");
    await upsertCandles(symbol, "1h", candles.value, candles.provider);
  });

  return NextResponse.json({
    job: "candles",
    daily: { okCount: daily.okCount, failCount: daily.failCount },
    h4: { okCount: h4.okCount, failCount: h4.failCount },
    h1: { okCount: h1.okCount, failCount: h1.failCount },
  });
}
