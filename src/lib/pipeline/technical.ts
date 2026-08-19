import { getInstrument } from "@/lib/instruments";
import { technicalFactor as demoTechnicalFactor } from "@/lib/scoring";
import { computeTechnicalTrend, TechnicalTrendResult } from "@/lib/engines/technical-trend";
import * as fmp from "@/services/market-data/fmp";
import { Provenance, NormalizedCandle } from "@/services/types";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const DAILY_ONLY_SOURCE = "Price & indicator engine (FMP daily candles)";
const FULL_SOURCE = "Price & indicator engine (FMP daily/4H/1H candles)";

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
  if (!instrument) return unavailableFactor("technical", FULL_SOURCE, `Unknown instrument ${symbol}`);

  const { daily, h4, h1, result } = await fetchTechnicalTrend(symbol);

  if (daily.status !== "live" || !daily.value) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return daily.status === "error" ? errorFactor("technical", DAILY_ONLY_SOURCE, daily.error ?? "request failed") : unavailableFactor("technical", DAILY_ONLY_SOURCE, "FMP daily candles unavailable");
  }

  if (!result) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return unavailableFactor("technical", DAILY_ONLY_SOURCE, "Insufficient candle history to compute indicators");
  }

  // Provenance reflects only the datasets that actually contributed to
  // this result — never claim 4H/1H confirmation was used when either
  // request came back unavailable (e.g. FMP 402 — plan doesn't include
  // intraday) or errored. computeTechnicalTrend() itself already computes
  // correctly from daily alone when h4/h1 are undefined; this only affects
  // what's reported about what was used.
  const h4Live = h4.status === "live" && Boolean(h4.value);
  const h1Live = h1.status === "live" && Boolean(h1.value);
  const now = new Date().toISOString();

  if (h4Live && h1Live) {
    return {
      key: "technical",
      rawScore: result.rawScore,
      explanation: result.explanation,
      source: FULL_SOURCE,
      provider: "fmp",
      freshness: "live",
      lastUpdated: daily.sourceUpdatedAt ?? now,
      nextUpdate: now,
    };
  }

  const missing: string[] = [];
  if (!h4Live) missing.push(h4.status === "unavailable" ? `4H (${h4.error ?? "unavailable"})` : "4H");
  if (!h1Live) missing.push(h1.status === "unavailable" ? `1H (${h1.error ?? "unavailable"})` : "1H");

  return {
    key: "technical",
    rawScore: result.rawScore,
    explanation: `Technical trend calculated from daily candles. Intraday confirmation unavailable (${missing.join(", ")}). ${result.explanation}`,
    source: DAILY_ONLY_SOURCE,
    provider: "fmp",
    // Real, live daily data — just not the full multi-timeframe picture —
    // so this isn't "stale" or "estimated"; "delayed" is the closest
    // existing status that still discounts confidence for the gap without
    // mischaracterizing genuinely-fresh daily data as old or fabricated.
    freshness: "delayed",
    lastUpdated: daily.sourceUpdatedAt ?? now,
    nextUpdate: now,
  };
}
