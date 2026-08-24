// Adapts the Capital.com client to the RetailSentimentProvider interface.
//
// NOT YET REGISTERED in index.ts's RETAIL_SENTIMENT_PROVIDERS — this
// adapter is complete and ready, but it is intentionally left out of the
// priority array until scripts/capital-com-retail-sentiment-verify.ts has
// confirmed real Capital.com marketIds (and real clientsentiment
// responses) for the target markets, per the "do not wire into production
// scoring until the mapping is verified with real responses" requirement
// this was built under. Once confirmed marketIds are added to
// symbol-map.ts, wiring this in is a one-line change to index.ts's
// RETAIL_SENTIMENT_PROVIDERS array (insert capitalComProvider after
// oandaProvider, ahead of igProvider/myfxbookProvider — see that file's
// priority-order comment).
import * as capitalCom from "../capital-com";
import { Provenance } from "../../types";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

async function getRetailSentiment(symbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  const result = await capitalCom.getRetailSentiment(symbol);
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

export const capitalComProvider: RetailSentimentProvider = {
  name: "capital-com",
  sourceLabel: "Capital.com Client Sentiment",
  getRetailSentiment,
};
