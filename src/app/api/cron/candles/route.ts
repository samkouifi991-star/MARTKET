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
import { dbWrite, demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronOrEventWatchAuth } from "../_shared";

// Ingestion diagnostic (production-freshness incident, H1/H4 trace): for
// each granularity, records per-symbol provider used and candle-row count
// actually fetched — separate from okCount/failCount, which only say
// whether the symbol succeeded, not how much data or through which
// provider (OANDA vs FMP fallback). Never read by anything but the JSON
// response below.
type CandleDiag = { provider: string; rowCount: number };

async function runGranularity(
  healthKey: string,
  symbols: string[],
  timeframe: "1d" | "4h" | "1h",
  fetchFn: (symbol: string) => ReturnType<typeof marketData.getDailyCandles>
) {
  const diag: Record<string, CandleDiag> = {};
  let rowsWritten = 0;
  const t0 = Date.now();
  const { results, okCount, failCount } = await runJobForEachSymbol(healthKey, symbols, async (symbol) => {
    const candles = await fetchFn(symbol);
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? `${timeframe} candles unavailable`);
    diag[symbol] = { provider: candles.provider, rowCount: candles.value.length };
    rowsWritten += candles.value.length;
    await dbWrite(() => upsertCandles(symbol, timeframe, candles.value!, candles.provider));
  });
  return {
    okCount,
    failCount,
    durationMs: Date.now() - t0,
    rowsWritten,
    results: results.map((r) => ({ ...r, provider: diag[r.symbol!]?.provider ?? null, rowCount: diag[r.symbol!]?.rowCount ?? 0 })),
  };
}

export async function GET(req: NextRequest) {
  if (!verifyCronOrEventWatchAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.map((i) => i.symbol);

  // Health-tracking keys stay "fmp:daily"/"fmp:4h"/"fmp:1h" (unchanged) —
  // gbpusd-validation.ts's admin page reads provider_health by these exact
  // literal keys; they name each candle job, not literally "always FMP"
  // (the jobs themselves now route per-symbol). Keyed per dataset (not a
  // shared row) so the admin page shows daily/4H/1H status independently.
  // Run strictly sequentially (daily, then 4h, then 1h) — never
  // Promise.all — so a shared per-provider rate limit shows up on one
  // granularity's numbers, never smeared across all three at once.
  const daily = await runGranularity("fmp:daily", symbols, "1d", (s) => marketData.getDailyCandles(s, 20 * 365));
  const h4 = await runGranularity("fmp:4h", symbols, "4h", (s) => marketData.getIntradayCandles(s, "4hour"));
  const h1 = await runGranularity("fmp:1h", symbols, "1h", (s) => marketData.getIntradayCandles(s, "1hour"));

  return NextResponse.json({ job: "candles", daily, h4, h1 });
}
