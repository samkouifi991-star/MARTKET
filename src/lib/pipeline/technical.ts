import { getInstrument } from "@/lib/instruments";
import { technicalFactor as demoTechnicalFactor } from "@/lib/scoring";
import { computeTechnicalTrend, TechnicalTrendResult } from "@/lib/engines/technical-trend";
import * as fmp from "@/services/market-data/fmp";
import { getDailyCandlesWithFallback } from "@/services/market-data/last-known-good";
import { Provenance, NormalizedCandle } from "@/services/types";
import { DataFreshness } from "@/lib/types";
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

/** Real data the caller can compute from: live, or last-known-good stored
 * data — never a synthetic/demo value. Distinct from "unavailable"/"error",
 * which mean there is genuinely nothing usable (including no stored
 * fallback), the only case that should render as unavailable. */
function hasUsableValue<T>(p: Provenance<T>): boolean {
  return (p.status === "live" || p.status === "delayed" || p.status === "stale") && p.value !== null;
}

/** Fetches real FMP candles (falling back to the last stored Neon rows if
 * the live call fails — see last-known-good.ts) and computes the
 * multi-timeframe technical result. Shared by resolveTechnicalFactor (the
 * scoring factor) and the market-detail price chart card, so both read the
 * exact same real indicators rather than each computing its own. */
export async function fetchTechnicalTrend(symbol: string): Promise<TechnicalTrendFetch> {
  const daily = await getDailyCandlesWithFallback(symbol);
  if (!hasUsableValue(daily)) {
    return { daily, h4: daily as Provenance<NormalizedCandle[]>, h1: daily as Provenance<NormalizedCandle[]>, result: null };
  }

  // Intraday candles have no historical DB storage yet (see db/schema.ts —
  // market_candles does hold 4h/1h rows, but nothing currently backfills
  // them), so these stay live-only; they're optional confirmation anyway.
  const [h4, h1] = await Promise.all([fmp.getIntradayCandles(symbol, "4hour"), fmp.getIntradayCandles(symbol, "1hour")]);
  const result = computeTechnicalTrend({
    daily: daily.value!,
    h4: h4.status === "live" && h4.value ? h4.value : undefined,
    h1: h1.status === "live" && h1.value ? h1.value : undefined,
  });

  return { daily, h4, h1, result };
}

function isFallbackSource(p: Provenance<unknown>): boolean {
  return p.source.includes("last known good");
}

export async function resolveTechnicalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("technical", FULL_SOURCE, `Unknown instrument ${symbol}`);

  const { daily, h4, h1, result } = await fetchTechnicalTrend(symbol);

  if (!hasUsableValue(daily)) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    // hasUsableValue() already ruled out live/delayed/stale above — this is
    // the genuine "nothing usable, including no stored fallback" case, so
    // the error/unavailable distinction from the live call still matters.
    return daily.status === "error"
      ? errorFactor("technical", DAILY_ONLY_SOURCE, daily.error ?? "request failed")
      : unavailableFactor("technical", DAILY_ONLY_SOURCE, daily.error ?? "FMP daily candles unavailable, and no stored candles exist yet to fall back to");
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
  const fromStorage = isFallbackSource(daily);

  // The daily candles' own freshness (live, or delayed/stale from
  // last-known-good storage) sets the floor — full live intraday
  // confirmation can only reach "live" when daily itself is genuinely live;
  // a fallback-sourced daily series can never be reported as fully live
  // even with confirming intraday data.
  const freshness: DataFreshness = daily.status !== "live" ? daily.status : h4Live && h1Live ? "live" : "delayed";

  if (freshness === "live") {
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

  const storageNote = fromStorage
    ? ` Live FMP refresh failed (${daily.error ?? "rate-limited"}); calculated from the last successfully stored daily candles instead (as of ${daily.fetchedAt}), not a live re-fetch.`
    : "";

  return {
    key: "technical",
    rawScore: result.rawScore,
    explanation: `Technical trend calculated from daily candles. Intraday confirmation unavailable (${missing.join(", ")}). ${result.explanation}${storageNote}`,
    source: fromStorage ? `${DAILY_ONLY_SOURCE} — last known good` : DAILY_ONLY_SOURCE,
    provider: "fmp",
    freshness,
    lastUpdated: daily.sourceUpdatedAt ?? now,
    nextUpdate: now,
  };
}
