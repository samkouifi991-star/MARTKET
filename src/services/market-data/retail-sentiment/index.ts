// Single entry point the scoring engine and UI use for retail sentiment.
// Callers must never import oanda.ts, myfxbook.ts, or ig-provider.ts (or
// ig.ts) directly — this is the only place that knows the provider
// priority order, so a future reordering or new provider never requires
// touching the pipeline or UI.
import { Provenance } from "../../types";
import { oandaProvider } from "./oanda";
import { myfxbookProvider } from "./myfxbook";
import { igProvider } from "./ig-provider";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

export type { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

// Priority order: OANDA PositionBook (primary — see oanda.ts) first, IG
// (secondary/optional, requires a confirmed epic + credentials) second,
// Myfxbook last as a fallback-only source — its session/auth flow proved
// unreliable for this deployment (see myfxbook.ts), so it's no longer
// primary, but stays wired in rather than deleted in case OANDA and IG are
// both ever unavailable. None of these being configured/covering a symbol
// ever blocks the pipeline — the combinator below just moves to the next.
//
// Capital.com (retail-sentiment/capital-com-provider.ts) is built and
// ready — intended priority OANDA -> Capital.com -> IG -> Myfxbook, i.e.
// secondary, ahead of IG (in practice IG never returns "live" today since
// every igEpic in symbol-map.ts is still null, so this order is
// functionally OANDA -> Capital.com -> Myfxbook) — but is deliberately NOT
// added to the array below yet. Every SymbolMapping.capitalComMarketId is
// still null; wire it in only after scripts/capital-com-retail-sentiment-verify.ts
// has confirmed real marketIds + real clientsentiment responses for the
// symbols it's meant to cover.
export const RETAIL_SENTIMENT_PROVIDERS: RetailSentimentProvider[] = [oandaProvider, igProvider, myfxbookProvider];

// Freshness tiers for a retail-sentiment observation, driven by the age of
// its own source timestamp (OANDA PositionBook's `time`, or the provider's
// best approximation for IG/Myfxbook) — never by how recently it happened
// to be fetched or written to storage. Same principle CFTC/FRED already
// apply (classifyCftcFreshness/classifyFredFreshness): a value read back
// from Neon is exactly as fresh as the observation it carries, no less.
// LIVE_WINDOW_HOURS is short (this data updates continuously on OANDA's
// side); DELAYED_WINDOW_HOURS matches the ~36h "still within the normal
// once-daily refresh cadence" convention already used across this file's
// siblings (see last-known-good.ts's RECENT_STORAGE_WINDOW_MS) — this
// project's Vercel plan blocks sub-daily cron schedules, so a same-day
// observation is expected, not degraded.
const LIVE_WINDOW_HOURS = 2;
const DELAYED_WINDOW_HOURS = 36;

export type RetailSentimentFreshness = "live" | "delayed" | "stale";

export function classifyRetailSentimentFreshness(sourceUpdatedAtIso: string): { freshness: RetailSentimentFreshness; ageHours: number } {
  const ageHours = (Date.now() - new Date(sourceUpdatedAtIso).getTime()) / 3_600_000;
  const freshness: RetailSentimentFreshness = ageHours <= LIVE_WINDOW_HOURS ? "live" : ageHours <= DELAYED_WINDOW_HOURS ? "delayed" : "stale";
  return { freshness, ageHours };
}

export async function getRetailSentiment(symbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  let best: Provenance<NormalizedRetailSentiment> | null = null;
  for (const provider of RETAIL_SENTIMENT_PROVIDERS) {
    const result = await provider.getRetailSentiment(symbol);
    if (result.status === "live") return result;
    // Keep the first (highest-priority) non-live result so an "unavailable"
    // reason always reflects the primary source, unless a later provider at
    // least produced an error worth surfacing over a plain unavailable.
    if (!best || (best.status === "unavailable" && result.status === "error")) best = result;
  }
  return best!;
}
