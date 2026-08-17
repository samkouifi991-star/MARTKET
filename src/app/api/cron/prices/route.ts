// Market prices — every 1-5 minutes (see spec section 13).
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import * as fmp from "@/services/market-data/fmp";
import { upsertMarketPrice } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const { okCount, failCount } = await runJobForEachSymbol("fmp", INSTRUMENTS.map((i) => i.symbol), async (symbol) => {
    const quote = await fmp.getQuote(symbol);
    if (quote.status !== "live" || !quote.value) throw new Error(quote.error ?? "quote unavailable");
    await upsertMarketPrice(symbol, quote.value, "fmp");
  });

  return NextResponse.json({ job: "prices", okCount, failCount });
}
