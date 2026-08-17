import { getInstrument } from "@/lib/instruments";
import { seasonalityFactor as demoSeasonalityFactor } from "@/lib/scoring";
import { computeCurrentMonthStat } from "@/lib/engines/seasonality";
import * as fmp from "@/services/market-data/fmp";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "Historical daily closes (FMP)";
const MIN_YEARS_FOR_LIVE = 2; // below this, the sample is too thin to be more than noise

export async function resolveSeasonalityFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("seasonality", SOURCE, `Unknown instrument ${symbol}`);

  // Request as much history as the plan allows; the engine only reports the
  // years it actually finds, so over-requesting is safe and never fabricates.
  const history = await fmp.getDailyCandles(symbol, 20 * 365);
  if (history.status !== "live" || !history.value) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return history.status === "error" ? errorFactor("seasonality", SOURCE, history.error ?? "request failed") : unavailableFactor("seasonality", SOURCE, "FMP historical candles unavailable");
  }

  const stat = computeCurrentMonthStat(history.value);
  if (!stat || stat.years < MIN_YEARS_FOR_LIVE) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return unavailableFactor("seasonality", SOURCE, `Only ${stat?.years ?? 0} year(s) of history available — below the ${MIN_YEARS_FOR_LIVE}-year minimum for a live seasonality read`);
  }

  const rawScore = Math.max(-10, Math.min(10, stat.avgReturn * 3));
  const explanation = `${stat.period} has averaged ${stat.avgReturn > 0 ? "+" : ""}${stat.avgReturn.toFixed(2)}% over ${stat.years} years of real price history, positive in ${stat.pctPositive}% of years (range ${stat.worstReturn.toFixed(1)}% to +${stat.bestReturn.toFixed(1)}%). Used as one contributing factor, not a standalone signal.`;

  const now = new Date().toISOString();
  return {
    key: "seasonality",
    rawScore,
    explanation,
    source: `${SOURCE} — ${stat.years}-year sample`,
    provider: "fmp",
    freshness: "live",
    lastUpdated: now,
    nextUpdate: now,
  };
}

function demoFallback(instrument: ReturnType<typeof getInstrument>): ResolvedFactor {
  const fallback = demoSeasonalityFactor(instrument!);
  return demoFallbackFactor({
    key: "seasonality",
    rawScore: fallback.raw,
    explanation: fallback.explanation,
    source: fallback.source,
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  });
}
