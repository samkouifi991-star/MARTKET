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
export const RETAIL_SENTIMENT_PROVIDERS: RetailSentimentProvider[] = [oandaProvider, igProvider, myfxbookProvider];

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
