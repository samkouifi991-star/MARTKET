// Scoring Engine V2's release-detection step — the first half of the
// pipeline diagram from the plan: "Economic release detected -> store
// release -> calculate surprise". This cron only detects newly-actualized
// releases and stores their normalized surprise (economicReleaseSurprises)
// — it deliberately does NOT create event shocks or trigger a recompute
// itself. Shock creation is asset-specific (the same CPI surprise means
// something different for Gold vs. equities vs. FX — see
// asset-interpretation/*, a later milestone) and belongs in engine.ts,
// which checks for any not-yet-shocked significant surprise relevant to a
// symbol AS PART OF computing that symbol's score — whether that
// computation is triggered by the daily scores-v2 cron or by Admin's
// manual "Recompute V2 now" button. Decoupling detection from shock
// creation this way means neither piece needs to know how the other is
// triggered.
//
// Never touches V1's tables or scores — this is purely additive to the
// shadow-mode V2 pipeline.
import { NextRequest, NextResponse } from "next/server";
import { fmpEconomicCalendarProvider } from "@/services/economic-calendar/fmp-provider";
import { countryCodeFor } from "@/services/economic-calendar/affected-markets";
import { updateEconomicEventClassification } from "@/db/queries/market-data";
import { getHistoricalEffectiveSurprises, hasProcessedReleaseKey, recordReleaseSurprise } from "@/db/queries/economic-releases";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { computeEffectiveSurprise, computeHistoricalDistribution, computeRevisionAdjustment, computeSurprise, computeSurpriseZ } from "@/lib/scoring-v2/economic-surprise";
import { demoModeSkip, isDemoMode, unauthorized, verifyCronAuth } from "../_shared";

// Detects releases actualized in roughly the last few days — generous
// enough to catch a release even if this cron's own run cadence slips a
// day, without re-scanning ancient history every run (hasRecordedSurprise
// makes re-scanning safe either way, this window just keeps the fetch small).
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

  let detectedCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (const release of result.value) {
    if (release.indicatorKey === null || release.importanceTier === null) {
      skippedCount++;
      continue; // unclassified event — never guessed, never surprise-scored
    }
    if (release.actual === null) {
      skippedCount++;
      continue; // scheduled but not yet released
    }

    // Enrichment only — a no-op if app/api/cron/calendar/route.ts (the sole
    // writer of the base economic_events row) hasn't stored this
    // externalId yet. That cron owns actual/previous/forecast/impact; this
    // one only ever backfills the V2-only classification columns.
    await updateEconomicEventClassification(release.id, { indicatorKey: release.indicatorKey, importanceTier: release.importanceTier, revisedPrevious: release.revisedPrevious }).catch(() => {});

    // Guaranteed non-null here — releaseKey is null exactly when
    // indicatorKey is null, and that case was already skipped above.
    const releaseKey = release.releaseKey!;
    if (await hasProcessedReleaseKey(releaseKey)) {
      skippedCount++;
      continue; // already processed on a prior run — idempotent
    }

    try {
      const country = countryCodeFor(release.country) ?? release.country;
      const surprise = computeSurprise(release.actual, release.forecast);
      const revisionAdjustment = computeRevisionAdjustment(release.previous, release.revisedPrevious);
      const effectiveSurprise = computeEffectiveSurprise(surprise, revisionAdjustment);

      let surpriseZ: number | null = null;
      if (effectiveSurprise !== null) {
        const history = await getHistoricalEffectiveSurprises(release.indicatorKey, country);
        const distribution = computeHistoricalDistribution(history);
        surpriseZ = computeSurpriseZ(effectiveSurprise, distribution);
      }

      await recordReleaseSurprise({
        indicatorKey: release.indicatorKey,
        country,
        releaseDateTime: release.dateTime,
        actual: release.actual,
        forecast: release.forecast,
        previous: release.previous,
        revisedPrevious: release.revisedPrevious,
        surprise,
        surpriseZ,
        effectiveSurprise,
        importanceTier: release.importanceTier,
        eventExternalId: release.id,
        releaseKey,
      });
      detectedCount++;
    } catch {
      failCount++;
    }
  }

  await recordProviderCheck({ provider: "fmp:economic-releases", ok: failCount === 0, latencyMs: Date.now() - t0 }).catch(() => {});
  return NextResponse.json({ job: "economic-releases", detectedCount, skippedCount, failCount });
}
