import { getInstrument } from "@/lib/instruments";
import { technicalFactor as demoTechnicalFactor } from "@/lib/scoring";
import { computeTechnicalTrend, TechnicalTrendResult } from "@/lib/engines/technical-trend";
import * as fmp from "@/services/market-data/fmp";
import { Provenance, NormalizedCandle } from "@/services/types";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "Price & indicator engine (FMP daily/4H/1H candles)";

export type TechnicalTrendFetch = {
  daily: Provenance<NormalizedCandle[]>;
  h4: Provenance<NormalizedCandle[]>;
  h1: Provenance<NormalizedCandle[]>;
  result: TechnicalTrendResult | null;
};

/** Fetches real FMP candles and computes the multi-timeframe technical
 * result. Shared by resolveTechnicalFactor (the scoring factor) and the
 * market-detail price chart card, so both read the exact same real
 * indicators rather than each computing its own. */
export async function fetchTechnicalTrend(symbol: string): Promise<TechnicalTrendFetch> {
  const daily = await fmp.getDailyCandles(symbol);
  if (daily.status !== "live" || !daily.value) {
    return { daily, h4: daily as Provenance<NormalizedCandle[]>, h1: daily as Provenance<NormalizedCandle[]>, result: null };
  }

  const [h4, h1] = await Promise.all([fmp.getIntradayCandles(symbol, "4hour"), fmp.getIntradayCandles(symbol, "1hour")]);
  const result = computeTechnicalTrend({
    daily: daily.value,
    h4: h4.status === "live" && h4.value ? h4.value : undefined,
    h1: h1.status === "live" && h1.value ? h1.value : undefined,
  });

  return { daily, h4, h1, result };
}

export async function resolveTechnicalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("technical", SOURCE, `Unknown instrument ${symbol}`);

  const { daily, result } = await fetchTechnicalTrend(symbol);

  if (daily.status !== "live" || !daily.value) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return daily.status === "error" ? errorFactor("technical", SOURCE, daily.error ?? "request failed") : unavailableFactor("technical", SOURCE, "FMP daily candles unavailable");
  }

  if (!result) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return unavailableFactor("technical", SOURCE, "Insufficient candle history to compute indicators");
  }

  const now = new Date().toISOString();
  return {
    key: "technical",
    rawScore: result.rawScore,
    explanation: result.explanation,
    source: SOURCE,
    provider: "fmp",
    freshness: "live",
    lastUpdated: daily.sourceUpdatedAt ?? now,
    nextUpdate: now,
  };
}
