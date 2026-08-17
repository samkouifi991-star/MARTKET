// Single entry point the scoring engine and UI use for retail sentiment.
// Callers must never import myfxbook.ts or ig-provider.ts (or ig.ts)
// directly — this is the only place that knows Myfxbook is primary and IG
// is a secondary/optional provider, so a future third provider (or a
// reordering) never requires touching the pipeline or UI.
import { Provenance } from "../../types";
import { myfxbookProvider } from "./myfxbook";
import { igProvider } from "./ig-provider";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

export type { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

// Priority order: Myfxbook (primary MVP source) first, IG (optional,
// requires confirmed epic + credentials) second.
export const RETAIL_SENTIMENT_PROVIDERS: RetailSentimentProvider[] = [myfxbookProvider, igProvider];

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
