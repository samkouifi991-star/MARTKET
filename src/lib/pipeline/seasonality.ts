import { getInstrument } from "@/lib/instruments";
import { seasonalityFactor as demoSeasonalityFactor } from "@/lib/scoring";
import { computeCurrentMonthStat } from "@/lib/engines/seasonality";
import { getDailyCandlesWithFallback } from "@/services/market-data/last-known-good";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "Historical daily closes (FMP)";
const MIN_YEARS_FOR_LIVE = 2; // below this, the sample is too thin to be more than noise

export async function resolveSeasonalityFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("seasonality", SOURCE, `Unknown instrument ${symbol}`);

  // Request as much history as the plan allows; the engine only reports the
  // years it actually finds, so over-requesting is safe and never fabricates.
  // Falls back to the last successfully stored daily candles (Neon) when
  // the live call fails — a real FMP outage must not blank this factor out
  // while genuine stored history exists.
  const history = await getDailyCandlesWithFallback(symbol, 20 * 365);
  const usable = (history.status === "live" || history.status === "delayed" || history.status === "stale") && history.value;
  if (!usable) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return history.status === "error" ? errorFactor("seasonality", SOURCE, history.error ?? "request failed") : unavailableFactor("seasonality", SOURCE, history.error ?? "FMP historical candles unavailable, and no stored candles exist yet to fall back to");
  }

  const stat = computeCurrentMonthStat(history.value!);
  if (!stat || stat.years < MIN_YEARS_FOR_LIVE) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return unavailableFactor("seasonality", SOURCE, `Only ${stat?.years ?? 0} year(s) of history available — below the ${MIN_YEARS_FOR_LIVE}-year minimum for a live seasonality read`);
  }

  const rawScore = Math.max(-10, Math.min(10, stat.avgReturn * 3));
  const fromStorage = history.source.includes("last known good");
  const storageNote = fromStorage ? ` Live FMP refresh failed (${history.error ?? "rate-limited"}); calculated from the last successfully stored daily candles instead (as of ${history.fetchedAt}), not a live re-fetch.` : "";
  const explanation = `${stat.period} has averaged ${stat.avgReturn > 0 ? "+" : ""}${stat.avgReturn.toFixed(2)}% over ${stat.years} years of real price history, positive in ${stat.pctPositive}% of years (range ${stat.worstReturn.toFixed(1)}% to +${stat.bestReturn.toFixed(1)}%). Used as one contributing factor, not a standalone signal.${storageNote}`;

  const now = new Date().toISOString();
  return {
    key: "seasonality",
    rawScore,
    explanation,
    source: fromStorage ? `${SOURCE} — ${stat.years}-year sample — last known good` : `${SOURCE} — ${stat.years}-year sample`,
    provider: "fmp",
    freshness: history.status,
    // The data's own timestamp (most recent stored/live candle date), not
    // page-render time — matches technical.ts's convention and fixes the
    // same "Last updated just now" bug this factor previously had even
    // when the underlying candles were hours or days old.
    lastUpdated: history.sourceUpdatedAt ?? now,
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
