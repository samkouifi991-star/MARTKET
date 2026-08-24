// Market prices — every 1-5 minutes (see spec section 13). Routed through
// market-data-router.ts (OANDA primary for the 10 configured FX pairs, FMP
// primary for everything else) so this cron never hardcodes a provider —
// upsertMarketPrice always stores the real provider the router returned.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import * as marketData from "@/services/market-data/market-data-router";
import { upsertMarketPrice } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  // Health-tracking key stays "fmp:quote" (unchanged) — gbpusd-validation.ts's
  // admin page reads provider_health by this exact literal key; it names the
  // quote-fetching job, not literally "always FMP" (the job itself now
  // routes per-symbol, see market-data-router.ts). Renaming it is a
  // separate, deliberate change, not a side effect of this one.
  const { okCount, failCount } = await runJobForEachSymbol("fmp:quote", INSTRUMENTS.map((i) => i.symbol), async (symbol) => {
    const quote = await marketData.getQuote(symbol);
    if (quote.status !== "live" || !quote.value) throw new Error(quote.error ?? "quote unavailable");
    await upsertMarketPrice(symbol, quote.value, quote.provider);
  });

  return NextResponse.json({ job: "prices", okCount, failCount });
}
