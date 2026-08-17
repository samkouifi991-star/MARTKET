// Adapts the existing IG Client Sentiment client to the RetailSentimentProvider
// interface, so it can sit behind Myfxbook as an optional secondary source.
// IG stays fully functional but is no longer a required dependency — see
// index.ts for the priority order.
import * as ig from "../ig";
import { Provenance } from "../../types";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

async function getRetailSentiment(symbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  const result = await ig.getRetailSentiment(symbol);
  if (!result.value) {
    return { ...result, value: null };
  }
  return {
    ...result,
    value: {
      symbol,
      pctLong: result.value.pctLong,
      pctShort: result.value.pctShort,
    },
  };
}

export const igProvider: RetailSentimentProvider = {
  name: "ig",
  sourceLabel: "IG Client Sentiment",
  getRetailSentiment,
};
