import { getInstrument } from "@/lib/instruments";
import { technicalFactor as demoTechnicalFactor } from "@/lib/scoring";
import { computeTechnicalTrend } from "@/lib/engines/technical-trend";
import * as fmp from "@/services/market-data/fmp";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { DataMode } from "@/services/data-mode";

const SOURCE = "Price & indicator engine (FMP daily/4H/1H candles)";

export async function resolveTechnicalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("technical", SOURCE, `Unknown instrument ${symbol}`);

  const daily = await fmp.getDailyCandles(symbol);
  if (daily.status !== "live" || !daily.value) {
    if (mode === "hybrid") {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return daily.status === "error" ? errorFactor("technical", SOURCE, daily.error ?? "request failed") : unavailableFactor("technical", SOURCE, "FMP daily candles unavailable");
  }

  const [h4, h1] = await Promise.all([fmp.getIntradayCandles(symbol, "4hour"), fmp.getIntradayCandles(symbol, "1hour")]);
  const result = computeTechnicalTrend({
    daily: daily.value,
    h4: h4.status === "live" && h4.value ? h4.value : undefined,
    h1: h1.status === "live" && h1.value ? h1.value : undefined,
  });

  if (!result) {
    if (mode === "hybrid") {
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
