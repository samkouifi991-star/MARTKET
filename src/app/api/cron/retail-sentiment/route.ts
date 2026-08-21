// Retail sentiment — every 15-60 minutes. Uses the RetailSentimentProvider
// combinator (Myfxbook primary, IG secondary/optional), so this job never
// hardcodes a specific provider. Only runs for instruments at least one
// provider covers; everything else is correctly absent from coverage rather
// than attempted and failing.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { insertRetailSentiment } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.filter((i) => {
    const mapping = getSymbolMapping(i.symbol);
    return Boolean(mapping?.myfxbookSymbol || mapping?.igEpic);
  }).map((i) => i.symbol);
  if (symbols.length === 0) {
    return NextResponse.json({ job: "retail-sentiment", okCount: 0, failCount: 0, note: "No instruments have retail-sentiment coverage yet" });
  }

  const { okCount, failCount } = await runJobForEachSymbol("retail-sentiment", symbols, async (symbol) => {
    const sentiment = await retailSentiment.getRetailSentiment(symbol);
    if (!sentiment.value) throw new Error(sentiment.error ?? "Retail sentiment unavailable");
    // Store the real status the provider reported (currently always "live"
    // for Myfxbook/IG — neither has an intrinsic staleness concept — but
    // this stays correct if a future provider adds one), not a hardcoded
    // "live" regardless of what actually came back.
    await insertRetailSentiment(symbol, sentiment.value.pctLong, sentiment.value.pctShort, sentiment.status, sentiment.provider, sentiment.source);
  });

  return NextResponse.json({ job: "retail-sentiment", okCount, failCount });
}
