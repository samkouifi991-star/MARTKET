// The shared release-processing core (requirement #1's "check economic
// calendar -> find newly released events -> store them -> compute
// surprises" half of the pipeline), used by BOTH the once-daily Vercel
// cron (app/api/cron/economic-releases/route.ts, a wide-window safety net)
// and the high-frequency externally-triggered watch route
// (app/api/watch/economic-releases/route.ts) — so the two entry points can
// never drift into subtly different detection/idempotency logic.
//
// Deliberately stops at "surprise computed and stored, tracking row marked
// processed" — it does NOT recompute any market itself. Recompute is a
// separate, additive step only the watch route performs (using this
// function's returned `processed` list to know which countries actually
// had something new happen this cycle, per requirement #1's "do not
// recompute all markets unnecessarily"). The daily cron calls this same
// function but never recomputes, matching its existing detection-only
// contract.
import { EconomicRelease } from "@/services/economic-calendar/provider";
import { EconomicIndicatorKey, ImportanceTier } from "@/services/economic-calendar/indicator-taxonomy";
import { affectedMarketsFor, countryCodeFor } from "@/services/economic-calendar/affected-markets";
import { updateEconomicEventClassification } from "@/db/queries/market-data";
import { getHistoricalEffectiveSurprises, hasDiagnostic, hasProcessedReleaseKey, recordReleaseSurprise, recordWatchDiagnostic } from "@/db/queries/economic-releases";
import { markReleaseProcessed, upsertReleaseTracking } from "@/db/queries/release-tracking";
import { computeEffectiveSurprise, computeHistoricalDistribution, computeRevisionAdjustment, computeSurprise, computeSurpriseZ } from "./economic-surprise";

// A HIGH/MEDIUM-impact release still not out this long after its scheduled
// time is worth flagging as a provider-latency anomaly (requirement #10) —
// well past ordinary reporting-time jitter, short enough to still be
// actionable same-day.
const MISSING_ACTUAL_THRESHOLD_MS = 45 * 60_000;

export type ProcessedRelease = { releaseKey: string; country: string; indicatorKey: EconomicIndicatorKey; importanceTier: ImportanceTier; surpriseId: number };

export type ProcessReleasesResult = {
  scanned: number;
  // Releases that were newly surprise-scored THIS run — the watch route
  // uses this list's countries to compute the targeted affected-market set.
  // A release already processed on a prior run is NOT included here again.
  processed: ProcessedRelease[];
  skippedCount: number;
  diagnosticsCount: number;
  failCount: number;
};

export async function processReleases(releases: EconomicRelease[]): Promise<ProcessReleasesResult> {
  const processed: ProcessedRelease[] = [];
  let skippedCount = 0;
  let diagnosticsCount = 0;
  let failCount = 0;

  for (const release of releases) {
    if (release.indicatorKey === null || release.importanceTier === null || release.releaseKey === null) {
      await recordWatchDiagnostic({ kind: "normalization_failure", releaseKey: null, rawEvent: release.event, country: release.country, detail: null }).catch(() => {});
      diagnosticsCount++;
      skippedCount++;
      continue; // unclassified event — never guessed, never surprise-scored
    }

    const releaseKey = release.releaseKey;
    const indicatorKey = release.indicatorKey;
    const importanceTier = release.importanceTier;
    const country = countryCodeFor(release.country) ?? release.country;

    // Enrichment only — a no-op if app/api/cron/calendar/route.ts (the sole
    // writer of the base economic_events row) hasn't stored this
    // externalId yet. That cron owns actual/previous/forecast/impact; this
    // one only ever backfills the V2-only classification columns.
    await updateEconomicEventClassification(release.id, { indicatorKey, importanceTier, revisedPrevious: release.revisedPrevious }).catch(() => {});

    if ((importanceTier === "HIGH" || importanceTier === "MEDIUM") && release.forecast === null && !(await hasDiagnostic("missing_forecast", releaseKey))) {
      await recordWatchDiagnostic({ kind: "missing_forecast", releaseKey, rawEvent: release.event, country, detail: null }).catch(() => {});
      diagnosticsCount++;
    }

    // FMP never supplies a revised-prior value today (see fmp-provider.ts) —
    // this fires honestly on essentially every HIGH-impact release with a
    // real prior value, which is exactly the point: it's the real evidence
    // for whether a better calendar provider is worth paying for.
    if (importanceTier === "HIGH" && release.previous !== null && release.revisedPrevious === null && !(await hasDiagnostic("missing_revision", releaseKey))) {
      await recordWatchDiagnostic({ kind: "missing_revision", releaseKey, rawEvent: release.event, country, detail: "Provider did not supply a revised prior value." }).catch(() => {});
      diagnosticsCount++;
    }

    await upsertReleaseTracking({
      releaseKey,
      provider: "fmp",
      country,
      indicatorKey,
      rawEvent: release.event,
      importanceTier,
      scheduledAt: release.dateTime,
      forecast: release.forecast,
      previous: release.previous,
      actual: release.actual,
      revisedPrevious: release.revisedPrevious,
    }).catch(() => null);

    if (release.actual === null) {
      const overdue = Date.now() - new Date(release.dateTime).getTime() > MISSING_ACTUAL_THRESHOLD_MS;
      if (overdue && (importanceTier === "HIGH" || importanceTier === "MEDIUM") && !(await hasDiagnostic("missing_actual", releaseKey))) {
        await recordWatchDiagnostic({ kind: "missing_actual", releaseKey, rawEvent: release.event, country, detail: null }).catch(() => {});
        diagnosticsCount++;
      }
      skippedCount++;
      continue; // scheduled but not yet released
    }

    if (await hasProcessedReleaseKey(releaseKey)) {
      skippedCount++;
      continue; // already surprise-scored on a prior run — idempotent (revision handling, if any, happened above via upsertReleaseTracking's own state machine, never a re-shock)
    }

    try {
      const surprise = computeSurprise(release.actual, release.forecast);
      const revisionAdjustment = computeRevisionAdjustment(release.previous, release.revisedPrevious);
      const effectiveSurprise = computeEffectiveSurprise(surprise, revisionAdjustment);

      let surpriseZ: number | null = null;
      if (effectiveSurprise !== null) {
        const history = await getHistoricalEffectiveSurprises(indicatorKey, country);
        const distribution = computeHistoricalDistribution(history);
        surpriseZ = computeSurpriseZ(effectiveSurprise, distribution);
      }

      const surpriseId = await recordReleaseSurprise({
        indicatorKey,
        country,
        releaseDateTime: release.dateTime,
        actual: release.actual,
        forecast: release.forecast,
        previous: release.previous,
        revisedPrevious: release.revisedPrevious,
        surprise,
        surpriseZ,
        effectiveSurprise,
        importanceTier,
        eventExternalId: release.id,
        releaseKey,
      });

      await markReleaseProcessed(releaseKey, { surpriseId, affectedMarkets: affectedMarketsFor(release.country) });
      processed.push({ releaseKey, country, indicatorKey, importanceTier, surpriseId });
    } catch {
      failCount++;
    }
  }

  return { scanned: releases.length, processed, skippedCount, diagnosticsCount, failCount };
}
