import { Provenance } from "../../types";

// The scoring engine (and every UI component) talks to retail sentiment
// only through this shape — it must never know or care whether the number
// came from Myfxbook, IG, or a future provider. pctLong/pctShort are the
// only fields the scoring engine reads; everything else is optional,
// provider-specific context shown for transparency on the market detail page.
export type NormalizedRetailSentiment = {
  symbol: string;
  pctLong: number;
  pctShort: number;
  longPositions?: number;
  shortPositions?: number;
  longVolume?: number;
  shortVolume?: number;
  avgLongPrice?: number;
  avgShortPrice?: number;
  /** OANDA PositionBook only: the un-renormalized aggregate long/short
   * weight (sum of each price bucket's longCountPercent/shortCountPercent)
   * before excluding the book's unclassified remainder — see oanda.ts for
   * the exact aggregation. pctLong/pctShort above are the renormalized
   * 0-100 long/short-only split the scoring engine actually reads. */
  aggregateLongWeight?: number;
  aggregateShortWeight?: number;
  totalPositioningWeight?: number;
};

export interface RetailSentimentProvider {
  readonly name: string;
  readonly sourceLabel: string;
  getRetailSentiment(symbol: string): Promise<Provenance<NormalizedRetailSentiment>>;
}
