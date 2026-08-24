// The high-frequency economic-release watcher (requirement #1) — meant to
// be called roughly every 5 minutes by an external scheduler (GitHub
// Actions; see .github/workflows/economic-release-watch.yml), NOT by
// Vercel Cron (Hobby plan caps cron at once daily). Protected by
// EVENT_WATCH_SECRET (or CRON_SECRET as a fallback) so it can't be
// triggered by anyone who finds the URL.
//
// Narrower window than the daily cron: a release detected once by either
// entry point is idempotent via processReleases' releaseKey-based guard,
// so there's no harm in the two windows overlapping.
//
// The one thing this route does that the daily cron deliberately does NOT:
// targeted recompute. For every country that had a release newly
// surprise-scored THIS run, it recomputes only
// affectedMarketsFor(country) ∩ strictLiveSymbolList() — never every
// strict-live market — writing only to Scoring Engine V2's shadow tables.
// No V1 table, route, or score is ever touched here.
import { NextRequest, NextResponse } from "next/server";
import { fmpEconomicCalendarProvider } from "@/services/economic-calendar/fmp-provider";
import { affectedMarketsFor } from "@/services/economic-calendar/affected-markets";
import { processReleases } from "@/lib/scoring-v2/release-watch";
import { computeMarketScoreV2 } from "@/lib/scoring-v2/engine";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { DATA_MODE, isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
// Shared with the daily cron's auth/demo-mode helpers — a watch route
// triggered by an external scheduler is the same kind of authenticated
// background job as a Vercel cron route, just with a different trigger.
import { demoModeSkip, unauthorized, verifyEventWatchAuth } from "../../cron/_shared";

// Narrow enough to keep each run's calendar fetch small at 5-minute
// cadence, wide enough to safely catch a release even if one poll is
// missed or delayed — releaseKey-based idempotency makes any overlap safe.
const LOOKBACK_HOURS = 6;
const LOOKAHEAD_HOURS = 2;

export async function GET(req: NextRequest) {
  if (!verifyEventWatchAuth(req)) return unauthorized();
  if (isDemoOnly()) return demoModeSkip();

  const t0 = Date.now();
  const from = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const to = new Date(Date.now() + LOOKAHEAD_HOURS * 3_600_000).toISOString();

  const result = await fmpEconomicCalendarProvider.getReleases(from, to);
  if (!result.value) {
    await recordProviderCheck({ provider: "fmp:economic-releases-watch", ok: false, latencyMs: Date.now() - t0, error: result.error ?? "calendar unavailable" }).catch(() => {});
    return NextResponse.json({ job: "economic-releases-watch", processedCount: 0, recomputedMarkets: [], skippedCount: 0, failCount: 1, error: result.error }, { status: 502 });
  }

  const { processed, skippedCount, diagnosticsCount, failCount } = await processReleases(result.value);

  // Requirement #1: only the markets a newly-processed release's country
  // actually affects, intersected with what V2 covers at all — never every
  // strict-live market just because SOMETHING happened this cycle.
  const liveSymbols = new Set(strictLiveSymbolList());
  const countriesThisRun = new Set(processed.map((p) => p.country));
  const symbolsToRecompute = new Set<string>();
  for (const country of countriesThisRun) {
    for (const symbol of affectedMarketsFor(country)) {
      if (liveSymbols.has(symbol)) symbolsToRecompute.add(symbol);
    }
  }

  const recomputeResults = await Promise.allSettled(
    Array.from(symbolsToRecompute).map((symbol) => computeMarketScoreV2(symbol, DATA_MODE, { storageOnly: true, persist: true }))
  );
  const recomputedMarkets = Array.from(symbolsToRecompute).filter((_, i) => recomputeResults[i].status === "fulfilled");

  await recordProviderCheck({ provider: "fmp:economic-releases-watch", ok: failCount === 0, latencyMs: Date.now() - t0 }).catch(() => {});
  return NextResponse.json({
    job: "economic-releases-watch",
    processedCount: processed.length,
    recomputedMarkets,
    skippedCount,
    diagnosticsCount,
    failCount,
  });
}
