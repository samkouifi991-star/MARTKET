import { getInstrument } from "@/lib/instruments";
import { institutionalFactor as demoInstitutionalFactor } from "@/lib/scoring";
import { computeInstitutionalMomentum, detectDivergenceSignal, DivergenceInput, SmartMoneySignal } from "@/lib/engines/smart-money";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import { getPositioningWithFallback, getQuoteWithFallback, getRetailSentimentWithFallback } from "@/services/market-data/last-known-good";
import { demoFallbackFactor, errorFactor, notApplicableFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const SOURCE = "CFTC Commitments of Traders";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// No CFTC-reportable futures contract exists for this symbol at all (e.g.
// FX crosses, non-US-regulated index futures — see symbol-map.ts's own
// comments on exactly which and why). That's a permanent, structural gap,
// not a temporary provider outage, so both Institutional Positioning and
// Smart Money (which is built on the same CFTC data) should say so plainly
// rather than reading as "should have data, currently doesn't."
function hasCftcCoverage(symbol: string): boolean {
  return getSymbolMapping(symbol)?.cftc != null;
}

export async function resolveInstitutionalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("institutional", SOURCE, `Unknown instrument ${symbol}`);
  if (!hasCftcCoverage(symbol)) return notApplicableFactor("institutional", SOURCE, `no CFTC-reportable futures contract exists for ${symbol}`);

  // Storage-first: tries the live CFTC call first, falls back to the last
  // stored report (DELAYED/STALE) on a genuine failure, and never presents
  // a report beyond CFTC's own freshness limit — see last-known-good.ts.
  const positioning = await getPositioningWithFallback(symbol);
  if (!positioning.value) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoInstitutionalFactor(instrument);
      return demoFallbackFactor({ key: "institutional", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return positioning.status === "error" ? errorFactor("institutional", positioning.source, positioning.error ?? "request failed") : unavailableFactor("institutional", positioning.source, positioning.error ?? `No CFTC coverage for ${symbol}`);
  }
  // status is "live", "delayed", or "stale" here — all carry a real (not
  // fabricated) value; a too-old report was already rejected before this
  // branch, either inside getInstitutionalPositioning (>45d) or by the
  // fallback's own freshness-limit check on a stored report.

  const pos = positioning.value;
  const skew = clamp(((pos.pctLong - 50) / 50) * 10);
  const momentum = clamp((pos.netWeeklyChange / Math.max(1, Math.abs(pos.netPositioning) || 1)) * 10);
  let raw = skew * 0.6 + momentum * 0.4;
  const pct = pos.percentile3y ?? pos.percentile1y;
  const extreme = pct !== null && (pct >= 90 || pct <= 10);
  if (extreme) raw *= 0.5;
  raw = clamp(raw);

  const fromStorage = positioning.source.includes("last known good");
  let explanation = `${pos.classification}s are ${pos.pctLong.toFixed(0)}% long / ${pos.pctShort.toFixed(0)}% short with a net weekly change of ${pos.netWeeklyChange > 0 ? "+" : ""}${pos.netWeeklyChange.toLocaleString()} contracts${pct !== null ? ` (${pct}th percentile vs. ${pos.percentile3y !== null ? "3-year" : "1-year"} history)` : ""}.`;
  if (extreme) explanation += " Positioning is historically crowded, so the score is dampened for overcrowding / reversal risk rather than treated as automatically directional.";
  if (fromStorage) explanation += ` Live CFTC refresh failed (${positioning.error ?? "unavailable"}); showing the last successfully stored report instead, not a live re-fetch.`;

  return {
    key: "institutional",
    rawScore: raw,
    explanation,
    source: positioning.source,
    provider: "cftc",
    freshness: positioning.status,
    lastUpdated: positioning.sourceUpdatedAt ?? new Date().toISOString(),
    nextUpdate: positioning.nextExpectedUpdate ?? new Date().toISOString(),
  };
}

export type SmartMoneyResolution = {
  signal: SmartMoneySignal;
  confidence: number;
  explanation: string;
  provider: string;
  freshness: "live" | "delayed" | "stale" | "unavailable" | "error" | "not_applicable";
};

export async function resolveSmartMoney(symbol: string): Promise<SmartMoneyResolution> {
  if (!hasCftcCoverage(symbol)) {
    return {
      signal: "None",
      confidence: 0,
      explanation: `Smart Money is built on CFTC institutional positioning momentum, and no CFTC-reportable futures contract exists for ${symbol} — not applicable for this asset, not a temporary outage.`,
      provider: "cftc",
      freshness: "not_applicable",
    };
  }
  const [positioning, sentiment, quote] = await Promise.all([getPositioningWithFallback(symbol), getRetailSentimentWithFallback(symbol), getQuoteWithFallback(symbol)]);

  if (!positioning.value) {
    return { signal: "None", confidence: 0, explanation: "Institutional positioning data is unavailable for this market, so Smart Money cannot be evaluated.", provider: "cftc", freshness: "unavailable" };
  }

  const pos = positioning.value;
  const momentum = computeInstitutionalMomentum(pos.classification, pos.netHistory);
  const sentimentUsable = (sentiment.status === "live" || sentiment.status === "delayed" || sentiment.status === "stale") && sentiment.value;

  const divergenceInput: DivergenceInput = {
    netPositioning: pos.netPositioning,
    netWeeklyChange: pos.netWeeklyChange,
    percentile: pos.percentile3y ?? pos.percentile1y,
    priceChangePct: (quote.status === "live" || quote.status === "delayed" || quote.status === "stale") && quote.value ? quote.value.changePct24h : 0,
    retail: sentimentUsable ? { pctLong: sentiment.value!.pctLong, pctShort: sentiment.value!.pctShort, change7d: 0 } : null,
  };
  const divergence = detectDivergenceSignal(divergenceInput);

  const fromStorage = positioning.source.includes("last known good");
  const explanation = (momentum ? `${momentum.explanation} ${divergence.signal !== "None" ? divergence.explanation : ""}`.trim() : divergence.explanation) + (fromStorage ? " (from the last successfully stored CFTC report — live refresh failed.)" : "");

  return {
    signal: divergence.signal,
    confidence: divergence.confidence,
    explanation,
    provider: "cftc" + (sentimentUsable ? `+${sentiment.provider}` : ""),
    // positioning.value is truthy here, so status is really only ever
    // live/delayed/stale — CFTC/last-known-good never produce "estimated".
    freshness: positioning.status as SmartMoneyResolution["freshness"],
  };
}
