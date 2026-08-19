import { getInstrument } from "@/lib/instruments";
import { institutionalFactor as demoInstitutionalFactor } from "@/lib/scoring";
import { computeInstitutionalMomentum, detectDivergenceSignal, DivergenceInput, SmartMoneySignal } from "@/lib/engines/smart-money";
import * as cftc from "@/services/market-data/cftc";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import * as fmp from "@/services/market-data/fmp";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "CFTC Commitments of Traders";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

export async function resolveInstitutionalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("institutional", SOURCE, `Unknown instrument ${symbol}`);

  const positioning = await cftc.getInstitutionalPositioning(symbol);
  if (!positioning.value) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoInstitutionalFactor(instrument);
      return demoFallbackFactor({ key: "institutional", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return positioning.status === "error" ? errorFactor("institutional", positioning.source, positioning.error ?? "request failed") : unavailableFactor("institutional", positioning.source, positioning.error ?? `No CFTC coverage for ${symbol}`);
  }
  // status is "live" or "stale" here — both carry a real (not fabricated)
  // value; a too-old report was already rejected to unavailable() inside
  // getInstitutionalPositioning and never reaches this branch with a value.

  const pos = positioning.value;
  const skew = clamp(((pos.pctLong - 50) / 50) * 10);
  const momentum = clamp((pos.netWeeklyChange / Math.max(1, Math.abs(pos.netPositioning) || 1)) * 10);
  let raw = skew * 0.6 + momentum * 0.4;
  const pct = pos.percentile3y ?? pos.percentile1y;
  const extreme = pct !== null && (pct >= 90 || pct <= 10);
  if (extreme) raw *= 0.5;
  raw = clamp(raw);

  let explanation = `${pos.classification}s are ${pos.pctLong.toFixed(0)}% long / ${pos.pctShort.toFixed(0)}% short with a net weekly change of ${pos.netWeeklyChange > 0 ? "+" : ""}${pos.netWeeklyChange.toLocaleString()} contracts${pct !== null ? ` (${pct}th percentile vs. ${pos.percentile3y !== null ? "3-year" : "1-year"} history)` : ""}.`;
  if (extreme) explanation += " Positioning is historically crowded, so the score is dampened for overcrowding / reversal risk rather than treated as automatically directional.";

  return {
    key: "institutional",
    rawScore: raw,
    explanation,
    source: positioning.source,
    provider: "cftc",
    freshness: positioning.status === "stale" ? "stale" : "live",
    lastUpdated: positioning.sourceUpdatedAt ?? new Date().toISOString(),
    nextUpdate: positioning.nextExpectedUpdate ?? new Date().toISOString(),
  };
}

export type SmartMoneyResolution = {
  signal: SmartMoneySignal;
  confidence: number;
  explanation: string;
  provider: string;
  freshness: "live" | "stale" | "unavailable" | "error";
};

export async function resolveSmartMoney(symbol: string): Promise<SmartMoneyResolution> {
  const [positioning, sentiment, quote] = await Promise.all([cftc.getInstitutionalPositioning(symbol), retailSentiment.getRetailSentiment(symbol), fmp.getQuote(symbol)]);

  if (!positioning.value) {
    return { signal: "None", confidence: 0, explanation: "Institutional positioning data is unavailable for this market, so Smart Money cannot be evaluated.", provider: "cftc", freshness: "unavailable" };
  }

  const pos = positioning.value;
  const momentum = computeInstitutionalMomentum(pos.classification, pos.netHistory);

  const divergenceInput: DivergenceInput = {
    netPositioning: pos.netPositioning,
    netWeeklyChange: pos.netWeeklyChange,
    percentile: pos.percentile3y ?? pos.percentile1y,
    priceChangePct: quote.status === "live" && quote.value ? quote.value.changePct24h : 0,
    retail: sentiment.status === "live" && sentiment.value ? { pctLong: sentiment.value.pctLong, pctShort: sentiment.value.pctShort, change7d: 0 } : null,
  };
  const divergence = detectDivergenceSignal(divergenceInput);

  const explanation = momentum ? `${momentum.explanation} ${divergence.signal !== "None" ? divergence.explanation : ""}`.trim() : divergence.explanation;

  return {
    signal: divergence.signal,
    confidence: divergence.confidence,
    explanation,
    provider: "cftc" + (sentiment.status === "live" ? `+${sentiment.provider}` : ""),
    freshness: positioning.status === "stale" ? "stale" : "live",
  };
}
