import { getInstrument } from "@/lib/instruments";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "@/lib/config";
import * as ig from "@/services/market-data/ig";
import { errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { DataMode } from "@/services/data-mode";

const SOURCE = "IG Client Sentiment";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// Retail sentiment deliberately never falls back to demo data, in hybrid or
// live mode — the spec singles this factor out with an unconditional "never
// estimate sentiment" rule, unlike the other factors' general hybrid
// fallback. `mode` is accepted only so this resolver matches the shared
// RESOLVERS signature used by the scoring engine.
export async function resolveRetailSentimentFactor(symbol: string, _mode: DataMode): Promise<ResolvedFactor> {
  void _mode;
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("retailSentiment", SOURCE, `Unknown instrument ${symbol}`);

  const sentiment = await ig.getRetailSentiment(symbol);
  if (sentiment.status !== "live" || !sentiment.value) {
    return sentiment.status === "error"
      ? errorFactor("retailSentiment", SOURCE, sentiment.error ?? "request failed")
      : unavailableFactor("retailSentiment", SOURCE, "Retail sentiment unavailable — IG does not cover this market");
  }

  const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
  const { pctLong, pctShort } = sentiment.value;
  let raw = 0;
  let explanation = `${pctLong.toFixed(0)}% of retail traders are long / ${pctShort.toFixed(0)}% short, within normal range — no contrarian signal generated.`;
  if (pctLong > extremeLongThreshold) {
    const severity = clamp((pctLong - extremeLongThreshold) / 40, 0, 1);
    raw = -severity * 10;
    explanation = `${pctLong.toFixed(0)}% of retail traders are long (above the ${extremeLongThreshold}% extreme threshold), generating a contrarian bearish contribution that strengthens with how extreme positioning is.`;
  } else if (pctShort > extremeShortThreshold) {
    const severity = clamp((pctShort - extremeShortThreshold) / 40, 0, 1);
    raw = severity * 10;
    explanation = `${pctShort.toFixed(0)}% of retail traders are short (above the ${extremeShortThreshold}% extreme threshold), generating a contrarian bullish contribution that strengthens with how extreme positioning is.`;
  }

  return {
    key: "retailSentiment",
    rawScore: clamp(raw),
    explanation,
    source: SOURCE,
    provider: "ig",
    freshness: "live",
    lastUpdated: sentiment.sourceUpdatedAt ?? new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}
