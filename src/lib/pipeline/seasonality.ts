import { getInstrument } from "@/lib/instruments";
import { seasonalityFactor as demoSeasonalityFactor } from "@/lib/scoring";
import { computeCurrentMonthStat, computeHistoricalSampleDepth } from "@/lib/engines/seasonality";
import { getDailyCandlesWithFallback } from "@/services/market-data/last-known-good";
import { demoFallbackFactor, errorFactor, ResolvedFactor, seasonalityDepthFreshness, unavailableFactor, worseOf } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "Historical daily closes (FMP)";
const MIN_YEARS_FOR_LIVE = 3; // below this, the sample is too thin to be more than noise (see seasonalityDepthFreshness for the full tiering)

export async function resolveSeasonalityFactor(symbol: string, mode: DataMode, storageOnly = false): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("seasonality", SOURCE, `Unknown instrument ${symbol}`);

  // Request as much history as the plan allows; the engine only reports the
  // years it actually finds, so over-requesting is safe and never fabricates.
  // Falls back to the last successfully stored daily candles (Neon) when
  // the live call fails — a real FMP outage must not blank this factor out
  // while genuine stored history exists.
  const history = await getDailyCandlesWithFallback(symbol, 20 * 365, storageOnly);
  const usable = (history.status === "live" || history.status === "delayed" || history.status === "stale") && history.value;
  if (!usable) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return history.status === "error" ? errorFactor("seasonality", SOURCE, history.error ?? "request failed") : unavailableFactor("seasonality", SOURCE, history.error ?? "FMP historical candles unavailable, and no stored candles exist yet to fall back to");
  }

  const stat = computeCurrentMonthStat(history.value!);
  // The real span of the sample — distinct from stat.years, which counts
  // how many times the current month happens to appear in it and can look
  // deceptively "multi-year" from as little as ~13 months of daily candles
  // (the month appearing once near each edge). Gating and the sample
  // description below both use this real measure, never stat.years alone.
  const depth = computeHistoricalSampleDepth(history.value!);
  if (!stat || !depth || depth.yearsSpanned < MIN_YEARS_FOR_LIVE) {
    if (allowsDemoFallback(mode, symbol)) return demoFallback(instrument);
    return unavailableFactor(
      "seasonality",
      SOURCE,
      `Only ${depth?.yearsSpanned ?? 0} year(s) of real stored history (${depth?.observations ?? 0} candles, ${depth?.earliestDate ?? "n/a"} to ${depth?.latestDate ?? "n/a"}) — below the ${MIN_YEARS_FOR_LIVE}-year minimum for a seasonality read`
    );
  }

  const rawScore = Math.max(-10, Math.min(10, stat.avgReturn * 3));
  const fromStorage = history.source.includes("last known good");
  const storageNote = fromStorage && history.error ? ` ${history.error}` : "";
  const depthNote =
    depth.yearsSpanned < 10
      ? ` Sample covers ${depth.yearsSpanned} years of real history (${depth.observations} candles, ${depth.earliestDate} to ${depth.latestDate}) — reduced confidence versus a 10+ year sample.`
      : ` Sample covers ${depth.yearsSpanned} years of real history (${depth.observations} candles, ${depth.earliestDate} to ${depth.latestDate}).`;
  const explanation = `${stat.period} has averaged ${stat.avgReturn > 0 ? "+" : ""}${stat.avgReturn.toFixed(2)}% over ${stat.years} instance(s) of this period, positive in ${stat.pctPositive}% of those years (range ${stat.worstReturn.toFixed(1)}% to +${stat.bestReturn.toFixed(1)}%). Used as one contributing factor, not a standalone signal.${depthNote}${storageNote}`;

  // Freshness reflects the worse of two independent degradations: how
  // recently the data was refreshed (history.status), and how deep the
  // historical sample actually is (seasonalityDepthFreshness). A thin
  // sample legitimately dampens confidence exactly like stale data would.
  const freshness = worseOf(history.status, seasonalityDepthFreshness(depth.yearsSpanned));

  const now = new Date().toISOString();
  return {
    key: "seasonality",
    rawScore,
    explanation,
    source: fromStorage ? `${SOURCE} — ${depth.yearsSpanned}-year sample — last known good` : `${SOURCE} — ${depth.yearsSpanned}-year sample`,
    provider: "fmp",
    freshness,
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
