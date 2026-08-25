// Retail sentiment — the ONLY place a retail-sentiment provider is ever
// called live (page renders and the scoring engine read Neon only, via
// getRetailSentimentFromStorage — see last-known-good.ts). Uses the
// RetailSentimentProvider combinator (OANDA primary, IG secondary/optional,
// Myfxbook fallback-only — see retail-sentiment/index.ts), so this job
// never hardcodes a specific provider. Only runs for instruments at least
// one provider covers; everything else is correctly absent from coverage
// rather than attempted and failing.
//
// Cadence: intended to run roughly every 30-60 minutes (OANDA PositionBook
// updates far more often than once a day), but this project's Vercel plan
// is Hobby tier, which blocks sub-daily cron schedules entirely (see
// gbpusd-validation.ts's CRON_SCHEDULE comment) — so vercel.json keeps this
// on the same once-daily cadence as every other cron job until the plan
// changes. Revisit the schedule there if/when a higher Vercel plan lifts
// that restriction.
import { NextRequest, NextResponse } from "next/server";
import { INSTRUMENTS } from "@/lib/instruments";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { insertRetailSentiment } from "@/db/queries/market-data";
import { dbWrite, demoModeSkip, isDemoMode, runJobForEachSymbol, unauthorized, verifyCronOrEventWatchAuth } from "../_shared";

export async function GET(req: NextRequest) {
  if (!verifyCronOrEventWatchAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const symbols = INSTRUMENTS.filter((i) => {
    const mapping = getSymbolMapping(i.symbol);
    return Boolean(mapping?.oandaInstrument || mapping?.igEpic || mapping?.myfxbookSymbol);
  }).map((i) => i.symbol);
  if (symbols.length === 0) {
    return NextResponse.json({ job: "retail-sentiment", okCount: 0, failCount: 0, note: "No instruments have retail-sentiment coverage yet" });
  }

  const t0 = Date.now();
  const providerBySymbol: Record<string, string> = {};
  const { results, okCount, failCount } = await runJobForEachSymbol("retail-sentiment", symbols, async (symbol) => {
    const sentiment = await retailSentiment.getRetailSentiment(symbol);
    if (!sentiment.value) throw new Error(sentiment.error ?? "Retail sentiment unavailable");
    providerBySymbol[symbol] = sentiment.provider;
    // Store the real status the provider reported (currently always "live"
    // for Myfxbook/IG — neither has an intrinsic staleness concept — but
    // this stays correct if a future provider adds one), not a hardcoded
    // "live" regardless of what actually came back.
    await dbWrite(() => insertRetailSentiment(symbol, sentiment.value!.pctLong, sentiment.value!.pctShort, sentiment.status, sentiment.provider, sentiment.source, sentiment.sourceUpdatedAt));
  });

  return NextResponse.json({
    job: "retail-sentiment",
    okCount,
    failCount,
    durationMs: Date.now() - t0,
    rowsWritten: okCount,
    results: results.map((r) => ({ ...r, provider: providerBySymbol[r.symbol!] ?? null })),
  });
}
