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
};

export interface RetailSentimentProvider {
  readonly name: string;
  readonly sourceLabel: string;
  getRetailSentiment(symbol: string): Promise<Provenance<NormalizedRetailSentiment>>;
}
