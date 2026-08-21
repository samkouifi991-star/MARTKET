import { getInstrument } from "@/lib/instruments";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "@/lib/config";
import { getRetailSentimentFromStorage } from "@/services/market-data/last-known-good";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import { notApplicableFactor, ResolvedFactor, unavailableFactor } from "./types";
import { DataMode } from "@/services/data-mode";

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
  if (!instrument) return unavailableFactor("retailSentiment", "Retail Sentiment", `Unknown instrument ${symbol}`);

  // A permanent, structural gap (this asset class has no configured
  // retail-sentiment provider at all — e.g. crypto/indices aren't covered
  // by OANDA, IG, or Myfxbook today) is not the same thing as "the provider
  // is temporarily down." Checking the symbol map before reading storage
  // means this never gets counted as a data-quality problem in confidence.
  const mapping = getSymbolMapping(symbol);
  if (!mapping?.oandaInstrument && !mapping?.igEpic && !mapping?.myfxbookSymbol) {
    return notApplicableFactor("retailSentiment", "Retail Sentiment", `no retail-sentiment provider (OANDA/IG/Myfxbook) covers ${symbol} in the current provider set`);
  }

  // Storage-first — reads Neon only, never a live provider call (OANDA must
  // never be called from a page render; see last-known-good.ts's file
  // header). Freshness (live/delayed/stale) reflects the age of OANDA's own
  // source timestamp, not how recently the row was read from storage — a
  // snapshot the cron just wrote genuinely reads "live" here. Remains
  // UNAVAILABLE if no valid observation has ever existed for this symbol.
  const sentiment = await getRetailSentimentFromStorage(symbol);
  const SOURCE = sentiment.source;
  const usable = (sentiment.status === "live" || sentiment.status === "delayed" || sentiment.status === "stale") && sentiment.value;
  if (!usable) {
    return unavailableFactor("retailSentiment", SOURCE, sentiment.error ?? "Retail sentiment unavailable — no stored observation exists yet for this market");
  }

  const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
  const { pctLong, pctShort } = sentiment.value!;
  let raw = 0;
  let explanation = `${pctLong.toFixed(0)}% of retail traders are long / ${pctShort.toFixed(0)}% short, within normal range — no contrarian signal generated.`;
  if (pctLong > extremeLongThreshold) {
    const severity = clamp((pctLong - extremeLongThreshold) / 40, 0, 1);
    raw = -severity * 10;
    explanation = `${pctLong.toFixed(0)}% of retail traders are long / ${pctShort.toFixed(0)}% short — long positioning is above the ${extremeLongThreshold}% extreme threshold, generating a contrarian bearish contribution that strengthens with how extreme positioning is.`;
  } else if (pctShort > extremeShortThreshold) {
    const severity = clamp((pctShort - extremeShortThreshold) / 40, 0, 1);
    raw = severity * 10;
    explanation = `${pctLong.toFixed(0)}% of retail traders are long / ${pctShort.toFixed(0)}% short — short positioning is above the ${extremeShortThreshold}% extreme threshold, generating a contrarian bullish contribution that strengthens with how extreme positioning is.`;
  }
  if (sentiment.status === "stale") explanation += ` This reflects the last stored snapshot (${sentiment.fetchedAt}), older than the usual refresh window — the scheduled ingestion job has not refreshed it recently.`;

  return {
    key: "retailSentiment",
    rawScore: clamp(raw),
    explanation,
    source: SOURCE,
    provider: sentiment.provider,
    freshness: sentiment.status,
    lastUpdated: sentiment.sourceUpdatedAt ?? new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}
