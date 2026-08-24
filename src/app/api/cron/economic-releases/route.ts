// Scoring Engine V2's release-detection step — a redundant, wide-window
// daily safety net now that app/api/watch/economic-releases/route.ts polls
// every ~5 minutes via GitHub Actions. Both routes call the SAME shared
// core (lib/scoring-v2/release-watch.ts's processReleases) so detection/
// idempotency logic can never drift between the two entry points.
//
// Unchanged contract from before the high-frequency watcher existed: this
// route only detects and surprise-scores releases — it never recomputes a
// market itself. Shock creation is asset-specific and belongs in engine.ts,
// which checks for any not-yet-shocked significant surprise relevant to a
// symbol AS PART OF computing that symbol's score — whether triggered by
// the daily scores-v2 cron, Admin's manual "Recompute V2 now", or the
// watch route's targeted recompute.
//
// Never touches V1's tables or scores — this is purely additive to the
// shadow-mode V2 pipeline.
import { NextRequest, NextResponse } from "next/server";
import { fmpEconomicCalendarProvider } from "@/services/economic-calendar/fmp-provider";
import { processReleases } from "@/lib/scoring-v2/release-watch";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

// Wide enough to catch a release even if this cron's own run cadence slips
// a day, without re-scanning ancient history every run (processReleases's
// releaseKey-based idempotency makes re-scanning safe either way, this
// window just keeps the fetch small).
const LOOKBACK_DAYS = 4;
const LOOKAHEAD_DAYS = 1;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return unauthorized();
  if (isDemoMode()) return demoModeSkip();

  const t0 = Date.now();
  const from = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const to = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000).toISOString();

  const result = await fmpEconomicCalendarProvider.getReleases(from, to);
  if (!result.value) {
    await recordProviderCheck({ provider: "fmp:economic-releases", ok: false, latencyMs: Date.now() - t0, error: result.error ?? "calendar unavailable" }).catch(() => {});
    return NextResponse.json({ job: "economic-releases", detectedCount: 0, skippedCount: 0, failCount: 1, error: result.error }, { status: 502 });
  }

  const { processed, skippedCount, diagnosticsCount, failCount } = await processReleases(result.value);

  await recordProviderCheck({ provider: "fmp:economic-releases", ok: failCount === 0, latencyMs: Date.now() - t0 }).catch(() => {});
  return NextResponse.json({ job: "economic-releases", detectedCount: processed.length, skippedCount, diagnosticsCount, failCount });
}
