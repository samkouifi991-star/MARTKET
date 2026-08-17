// Historical candles (daily + intraday) — refreshed after new bars close.
// Runs once daily for the daily timeframe and is safe to run more often for
// intraday, since upsertCandles dedupes on (symbol, timeframe, date).
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import * as fmp from "@/services/market-data/fmp";
import { upsertCandles } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.map((i) => i.symbol);

  const daily = await runJobForEachSymbol("fmp", symbols, async (symbol) => {
    const candles = await fmp.getDailyCandles(symbol, 20 * 365);
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "daily candles unavailable");
    await upsertCandles(symbol, "1d", candles.value, "fmp");
  });

  const h4 = await runJobForEachSymbol("fmp", symbols, async (symbol) => {
    const candles = await fmp.getIntradayCandles(symbol, "4hour");
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "4H candles unavailable");
    await upsertCandles(symbol, "4h", candles.value, "fmp");
  });

  const h1 = await runJobForEachSymbol("fmp", symbols, async (symbol) => {
    const candles = await fmp.getIntradayCandles(symbol, "1hour");
    if (candles.status !== "live" || !candles.value) throw new Error(candles.error ?? "1H candles unavailable");
    await upsertCandles(symbol, "1h", candles.value, "fmp");
  });

  return NextResponse.json({
    job: "candles",
    daily: { okCount: daily.okCount, failCount: daily.failCount },
    h4: { okCount: h4.okCount, failCount: h4.failCount },
    h1: { okCount: h1.okCount, failCount: h1.failCount },
  });
}
