// The release lifecycle table (requirement #3: scheduled -> released ->
// processed -> revised). Kept separate from economic-releases.ts (which
// owns economicReleaseSurprises/eventShocks — rows that can only exist
// once `actual` is known) since a tracking row is created the moment a
// release first appears on the calendar, even before it's out, so latency
// (scheduledAt vs firstDetectedAt) and provider-quality diagnostics can be
// measured regardless of whether it's ever been surprise-scored.
import { desc, eq, gte } from "drizzle-orm";
import { getDb } from "../client";
import { economicReleaseTracking } from "../schema";
import { EconomicIndicatorKey, ImportanceTier } from "@/services/economic-calendar/indicator-taxonomy";

export type ReleaseTrackingState = "scheduled" | "released" | "processed" | "revised";

export type ReleaseTrackingRow = {
  id: number;
  releaseKey: string;
  provider: string;
  country: string;
  indicatorKey: EconomicIndicatorKey;
  rawEvent: string;
  importanceTier: ImportanceTier;
  scheduledAt: string;
  state: ReleaseTrackingState;
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  revisedPrevious: number | null;
  firstDetectedAt: string | null;
  processedAt: string | null;
  lastRevisedAt: string | null;
  surpriseId: number | null;
  affectedMarkets: string[];
};

type RawRow = typeof economicReleaseTracking.$inferSelect;

function mapRow(r: RawRow): ReleaseTrackingRow {
  return {
    id: r.id,
    releaseKey: r.releaseKey,
    provider: r.provider,
    country: r.country,
    indicatorKey: r.indicatorKey as EconomicIndicatorKey,
    rawEvent: r.rawEvent,
    importanceTier: r.importanceTier as ImportanceTier,
    scheduledAt: r.scheduledAt.toISOString(),
    state: r.state as ReleaseTrackingState,
    forecast: r.forecast,
    previous: r.previous,
    actual: r.actual,
    revisedPrevious: r.revisedPrevious,
    firstDetectedAt: r.firstDetectedAt?.toISOString() ?? null,
    processedAt: r.processedAt?.toISOString() ?? null,
    lastRevisedAt: r.lastRevisedAt?.toISOString() ?? null,
    surpriseId: r.surpriseId,
    affectedMarkets: (r.affectedMarkets as string[]) ?? [],
  };
}

export async function getReleaseTrackingByKey(releaseKey: string): Promise<ReleaseTrackingRow | null> {
  const db = getDb();
  const [row] = await db.select().from(economicReleaseTracking).where(eq(economicReleaseTracking.releaseKey, releaseKey)).limit(1);
  return row ? mapRow(row) : null;
}

export type ReleaseTrackingUpsertInput = {
  releaseKey: string;
  provider: string;
  country: string;
  indicatorKey: EconomicIndicatorKey;
  rawEvent: string;
  importanceTier: ImportanceTier;
  scheduledAt: string; // ISO
  forecast: number | null;
  previous: number | null;
  actual: number | null;
  revisedPrevious: number | null;
};

// What actually happened as a result of this upsert — release-watch.ts
// uses this to decide whether a fresh surprise computation is warranted
// (only "created_released" / "became_released": actual just appeared for
// the first time). A revision never triggers a new surprise/shock — see
// engine.ts's module comment and this session's explicit design decision.
export type ReleaseTrackingTransition = "created_scheduled" | "created_released" | "became_released" | "became_revised" | "unchanged";

/** Idempotent, state-machine-aware upsert: never regresses state backward,
 * and only stamps firstDetectedAt/lastRevisedAt at the correct transition —
 * safe to call every 5 minutes with the same or slightly-updated data for
 * the same release. */
export async function upsertReleaseTracking(input: ReleaseTrackingUpsertInput): Promise<{ row: ReleaseTrackingRow; transition: ReleaseTrackingTransition }> {
  const db = getDb();
  const now = new Date();
  const existing = await getReleaseTrackingByKey(input.releaseKey);

  if (!existing) {
    const initialState: ReleaseTrackingState = input.actual !== null ? "released" : "scheduled";
    const [row] = await db
      .insert(economicReleaseTracking)
      .values({
        releaseKey: input.releaseKey,
        provider: input.provider,
        country: input.country,
        indicatorKey: input.indicatorKey,
        rawEvent: input.rawEvent,
        importanceTier: input.importanceTier,
        scheduledAt: new Date(input.scheduledAt),
        state: initialState,
        forecast: input.forecast,
        previous: input.previous,
        actual: input.actual,
        revisedPrevious: input.revisedPrevious,
        firstDetectedAt: input.actual !== null ? now : null,
        updatedAt: now,
      })
      .returning();
    return { row: mapRow(row), transition: initialState === "released" ? "created_released" : "created_scheduled" };
  }

  if (existing.state === "processed" || existing.state === "revised") {
    const actualChanged = input.actual !== null && existing.actual !== null && input.actual !== existing.actual;
    const revisionChanged = input.revisedPrevious !== null && input.revisedPrevious !== existing.revisedPrevious;
    if (actualChanged || revisionChanged) {
      const [row] = await db
        .update(economicReleaseTracking)
        .set({
          actual: input.actual ?? existing.actual,
          revisedPrevious: input.revisedPrevious ?? existing.revisedPrevious,
          forecast: input.forecast ?? existing.forecast,
          previous: input.previous ?? existing.previous,
          state: "revised",
          lastRevisedAt: now,
          updatedAt: now,
        })
        .where(eq(economicReleaseTracking.releaseKey, input.releaseKey))
        .returning();
      return { row: mapRow(row), transition: "became_revised" };
    }
    // Nothing changed worth recording — still allow forecast/previous to be
    // backfilled if they were missing, without disturbing state/timestamps.
    const [row] = await db
      .update(economicReleaseTracking)
      .set({ forecast: input.forecast ?? existing.forecast, previous: input.previous ?? existing.previous, updatedAt: now })
      .where(eq(economicReleaseTracking.releaseKey, input.releaseKey))
      .returning();
    return { row: mapRow(row), transition: "unchanged" };
  }

  // Still "scheduled" or "released" (not yet processed) — the interesting
  // transition is `actual` appearing for the first time.
  const justDetected = existing.actual === null && input.actual !== null;
  const [row] = await db
    .update(economicReleaseTracking)
    .set({
      actual: input.actual ?? existing.actual,
      forecast: input.forecast ?? existing.forecast,
      previous: input.previous ?? existing.previous,
      revisedPrevious: input.revisedPrevious ?? existing.revisedPrevious,
      state: input.actual !== null ? "released" : existing.state,
      firstDetectedAt: existing.firstDetectedAt ? new Date(existing.firstDetectedAt) : justDetected ? now : null,
      updatedAt: now,
    })
    .where(eq(economicReleaseTracking.releaseKey, input.releaseKey))
    .returning();
  return { row: mapRow(row), transition: justDetected ? "became_released" : "unchanged" };
}

export async function markReleaseProcessed(releaseKey: string, input: { surpriseId: number; affectedMarkets: string[] }): Promise<void> {
  const db = getDb();
  await db
    .update(economicReleaseTracking)
    .set({ state: "processed", processedAt: new Date(), surpriseId: input.surpriseId, affectedMarkets: input.affectedMarkets, updatedAt: new Date() })
    .where(eq(economicReleaseTracking.releaseKey, releaseKey));
}

/** Recent releases, most-recently-scheduled first, for the Admin Event
 * Monitor (requirement #9). */
export async function getRecentReleaseTracking(limit = 50): Promise<ReleaseTrackingRow[]> {
  const db = getDb();
  const rows = await db.select().from(economicReleaseTracking).orderBy(desc(economicReleaseTracking.scheduledAt)).limit(limit);
  return rows.map(mapRow);
}

export type LatencySampleRow = { indicatorKey: EconomicIndicatorKey; scheduledAt: string; firstDetectedAt: string };

/** Raw (indicator, scheduled, detected) triples for lib/scoring-v2/
 * latency-stats.ts's pure median/P95 computation — this function does no
 * math itself, only fetches real rows that actually have both timestamps. */
export async function getLatencySamples(lookbackDays = 60): Promise<LatencySampleRow[]> {
  const db = getDb();
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await db.select().from(economicReleaseTracking).where(gte(economicReleaseTracking.scheduledAt, since));
  return rows
    .filter((r) => r.firstDetectedAt !== null)
    .map((r) => ({ indicatorKey: r.indicatorKey as EconomicIndicatorKey, scheduledAt: r.scheduledAt.toISOString(), firstDetectedAt: r.firstDetectedAt!.toISOString() }));
}
