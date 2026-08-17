// CFTC Commitments of Traders — weekly, after Friday's publication (see
// cftc.ts's nextFridayISO). Safe to run more often; onConflictDoNothing
// means re-running before a new report is out is a harmless no-op.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import * as cftc from "@/services/market-data/cftc";
import { upsertPositioning } from "@/db/queries/market-data";
import { demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.filter((i) => getSymbolMapping(i.symbol)?.cftc).map((i) => i.symbol);

  const { okCount, failCount } = await runJobForEachSymbol("cftc", symbols, async (symbol) => {
    const positioning = await cftc.getInstitutionalPositioning(symbol);
    if (positioning.status !== "live" || !positioning.value) throw new Error(positioning.error ?? "CFTC data unavailable");
    await upsertPositioning(symbol, positioning.value, positioning.source);
  });

  return NextResponse.json({ job: "positioning", okCount, failCount, totalCftcMarkets: symbols.length });
}
