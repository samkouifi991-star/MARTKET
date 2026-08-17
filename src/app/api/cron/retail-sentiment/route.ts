// IG Client Sentiment — every 15-60 minutes. Only runs for instruments with
// a confirmed IG epic; everything else is correctly absent from provider
// coverage rather than attempted and failing.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import * as ig from "@/services/market-data/ig";
import { insertRetailSentiment } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.filter((i) => getSymbolMapping(i.symbol)?.igEpic).map((i) => i.symbol);
  if (symbols.length === 0) {
    return NextResponse.json({ job: "retail-sentiment", okCount: 0, failCount: 0, note: "No instruments have a confirmed IG epic yet" });
  }

  const { okCount, failCount } = await runJobForEachSymbol("ig", symbols, async (symbol) => {
    const sentiment = await ig.getRetailSentiment(symbol);
    if (sentiment.status !== "live" || !sentiment.value) throw new Error(sentiment.error ?? "IG sentiment unavailable");
    await insertRetailSentiment(symbol, sentiment.value.pctLong, sentiment.value.pctShort, "live");
  });

  return NextResponse.json({ job: "retail-sentiment", okCount, failCount });
}
