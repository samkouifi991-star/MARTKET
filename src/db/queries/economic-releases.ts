// Read/write helpers for the economic-release surprise engine's own tables
// (economicReleaseSurprises, eventShocks — see schema.ts's V2 section).
// Kept separate from db/queries/scoring-v2.ts (which owns the shadow
// score/comparison tables) so each file's concern stays obvious.
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../client";
import { economicReleaseSurprises, economicWatchDiagnostics, eventShocks } from "../schema";
import { EconomicIndicatorKey, ImportanceTier } from "@/services/economic-calendar/indicator-taxonomy";

export type ReleaseSurpriseInput = {
  indicatorKey: EconomicIndicatorKey;
  country: string;
  releaseDateTime: string;
  actual: number;
  forecast: number | null;
  previous: number | null;
  revisedPrevious: number | null;
  surprise: number | null;
  surpriseZ: number | null;
  effectiveSurprise: number | null;
  importanceTier: ImportanceTier;
  eventExternalId: string | null;
  // The real, order-independent dedup identity (see release-identity.ts) —
  // eventExternalId above is kept only as a best-effort display join back
  // to economicEvents, never the idempotency key at 5-minute poll cadence.
  releaseKey: string | null;
};

export async function recordReleaseSurprise(input: ReleaseSurpriseInput): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(economicReleaseSurprises)
    .values({
      indicatorKey: input.indicatorKey,
      country: input.country,
      releaseDateTime: new Date(input.releaseDateTime),
      actual: input.actual,
      forecast: input.forecast,
      previous: input.previous,
      revisedPrevious: input.revisedPrevious,
      surprise: input.surprise,
      surpriseZ: input.surpriseZ,
      effectiveSurprise: input.effectiveSurprise,
      importanceTier: input.importanceTier,
      eventExternalId: input.eventExternalId,
      releaseKey: input.releaseKey,
    })
    .returning();
  return row.id;
}

/** Real historical effective-surprise observations for this exact
 * indicator+country pair, most recent first — the rolling sample
 * economic-surprise.ts's computeHistoricalDistribution normalizes against.
 * Excludes the just-recorded release itself when `excludeId` is given, so
 * a release never gets normalized against its own value. */
export async function getHistoricalEffectiveSurprises(indicatorKey: EconomicIndicatorKey, country: string, limit = 40, excludeId?: number): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(economicReleaseSurprises)
    .where(and(eq(economicReleaseSurprises.indicatorKey, indicatorKey), eq(economicReleaseSurprises.country, country)))
    .orderBy(desc(economicReleaseSurprises.releaseDateTime))
    .limit(limit + 1); // +1 buffer in case the just-recorded row is included and needs excluding
  return rows
    .filter((r) => r.id !== excludeId && r.effectiveSurprise !== null)
    .slice(0, limit)
    .map((r) => r.effectiveSurprise as number);
}

/** Idempotency guard for release detection: a release is only ever
 * surprise-scored once, no matter how many times a watcher run (daily cron
 * or the 5-minute GitHub Actions poll) re-fetches the same calendar row.
 * Keyed by releaseKey (provider+country+indicatorKey+releaseDateTime),
 * NOT the calendar provider's own raw id — see release-identity.ts's
 * module comment for why that raw id is unsafe at high poll frequency. */
export async function hasProcessedReleaseKey(releaseKey: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(economicReleaseSurprises).where(eq(economicReleaseSurprises.releaseKey, releaseKey)).limit(1);
  return rows.length > 0;
}

export type SurpriseRow = {
  id: number;
  indicatorKey: EconomicIndicatorKey;
  country: string;
  releaseDateTime: string;
  actual: number;
  forecast: number | null;
  previous: number | null;
  revisedPrevious: number | null;
  surprise: number | null;
  surpriseZ: number | null;
  effectiveSurprise: number | null;
  importanceTier: ImportanceTier;
};

/** Full stored surprise detail for one release — the Admin Event Monitor's
 * per-release drill-down (requirement #9) joins this in via
 * economicReleaseTracking.surpriseId. */
export async function getSurpriseById(id: number): Promise<SurpriseRow | null> {
  const db = getDb();
  const [row] = await db.select().from(economicReleaseSurprises).where(eq(economicReleaseSurprises.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    indicatorKey: row.indicatorKey as EconomicIndicatorKey,
    country: row.country,
    releaseDateTime: row.releaseDateTime.toISOString(),
    actual: row.actual,
    forecast: row.forecast,
    previous: row.previous,
    revisedPrevious: row.revisedPrevious,
    surprise: row.surprise,
    surpriseZ: row.surpriseZ,
    effectiveSurprise: row.effectiveSurprise,
    importanceTier: row.importanceTier as ImportanceTier,
  };
}

export type EventShockInput = { symbol: string; factorKey: string | null; sourceReleaseId: number | null; initialContribution: number; importanceTier: ImportanceTier };

export async function recordEventShock(input: EventShockInput): Promise<void> {
  const db = getDb();
  await db.insert(eventShocks).values({
    symbol: input.symbol,
    factorKey: input.factorKey,
    sourceReleaseId: input.sourceReleaseId,
    initialContribution: input.initialContribution,
    importanceTier: input.importanceTier,
  });
}

export type RecentSurpriseRow = {
  id: number;
  indicatorKey: EconomicIndicatorKey;
  country: string;
  actual: number;
  forecast: number | null;
  surpriseZ: number | null;
  importanceTier: ImportanceTier;
  releaseDateTime: string;
};

/** Real recent surprises for any of the given countries — engine.ts uses
 * this to find releases relevant to a symbol (e.g. both sides of an FX
 * pair, or a single country for Gold/indices/crypto) that might still need
 * a shock created for this symbol. sinceHours should comfortably exceed
 * every configured decay half-life (a much-older release would decay to 0
 * anyway) but stay bounded so this never scans the entire table. */
export async function getRecentSurprisesForCountries(countries: string[], sinceHours = 24 * 14): Promise<RecentSurpriseRow[]> {
  if (countries.length === 0) return [];
  const db = getDb();
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await db
    .select()
    .from(economicReleaseSurprises)
    .where(gte(economicReleaseSurprises.releaseDateTime, since))
    .orderBy(desc(economicReleaseSurprises.releaseDateTime));
  return rows
    .filter((r) => countries.includes(r.country))
    .map((r) => ({ id: r.id, indicatorKey: r.indicatorKey as EconomicIndicatorKey, country: r.country, actual: r.actual, forecast: r.forecast, surpriseZ: r.surpriseZ, importanceTier: r.importanceTier as ImportanceTier, releaseDateTime: r.releaseDateTime.toISOString() }));
}

/** Idempotency guard for shock CREATION (distinct from
 * hasRecordedSurprise, which guards surprise DETECTION): a given
 * symbol+release pair only ever produces one shock, no matter how many
 * times engine.ts computes that symbol's score afterward. */
export async function hasEventShockForRelease(symbol: string, sourceReleaseId: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(eventShocks)
    .where(and(eq(eventShocks.symbol, symbol), eq(eventShocks.sourceReleaseId, sourceReleaseId)))
    .limit(1);
  return rows.length > 0;
}

export type StoredEventShockRow = { symbol: string; factorKey: string | null; initialContribution: number; importanceTier: ImportanceTier; occurredAt: string };

/** All shocks created FROM one specific release, across every symbol —
 * the Admin Event Monitor's drill-down (requirement #9) "markets
 * recomputed" detail. Distinct from getRecentEventShocks (all of one
 * symbol's shocks, for engine.ts's own decay math). */
export async function getEventShocksForRelease(sourceReleaseId: number): Promise<StoredEventShockRow[]> {
  const db = getDb();
  const rows = await db.select().from(eventShocks).where(eq(eventShocks.sourceReleaseId, sourceReleaseId));
  return rows.map((r) => ({ symbol: r.symbol, factorKey: r.factorKey, initialContribution: r.initialContribution, importanceTier: r.importanceTier as ImportanceTier, occurredAt: r.occurredAt.toISOString() }));
}

/** All shocks for a symbol still within a generous lookback window (30
 * days covers every configured decay half-life with room to spare — a
 * shock past that point is negligible under any reasonable half-life and
 * excluded here rather than fetched and then discarded by event-shock.ts's
 * own decay math). */
export async function getRecentEventShocks(symbol: string, lookbackDays = 30): Promise<StoredEventShockRow[]> {
  const db = getDb();
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await db
    .select()
    .from(eventShocks)
    .where(and(eq(eventShocks.symbol, symbol), gte(eventShocks.occurredAt, since)));
  return rows.map((r) => ({ symbol: r.symbol, factorKey: r.factorKey, initialContribution: r.initialContribution, importanceTier: r.importanceTier as ImportanceTier, occurredAt: r.occurredAt.toISOString() }));
}

export type WatchDiagnosticKind = "missing_forecast" | "missing_actual" | "duplicate_event" | "normalization_failure" | "missing_revision";

export type WatchDiagnosticInput = { kind: WatchDiagnosticKind; releaseKey: string | null; rawEvent: string | null; country: string | null; detail: string | null };

export async function recordWatchDiagnostic(input: WatchDiagnosticInput): Promise<void> {
  const db = getDb();
  await db.insert(economicWatchDiagnostics).values({ kind: input.kind, releaseKey: input.releaseKey, rawEvent: input.rawEvent, country: input.country, detail: input.detail });
}

/** Dedup guard so a persistent anomaly (e.g. a HIGH-impact release still
 * missing its forecast) isn't re-logged every 5-minute poll — one
 * diagnostic per releaseKey+kind is enough to be actionable. */
export async function hasDiagnostic(kind: WatchDiagnosticKind, releaseKey: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(economicWatchDiagnostics).where(and(eq(economicWatchDiagnostics.kind, kind), eq(economicWatchDiagnostics.releaseKey, releaseKey))).limit(1);
  return rows.length > 0;
}

export type DiagnosticCounts = Record<WatchDiagnosticKind, number>;

/** Aggregate counts by kind over a lookback window, for the Admin
 * provider-latency/diagnostics card (requirement #10). */
export async function getRecentDiagnosticCounts(lookbackDays = 30): Promise<DiagnosticCounts> {
  const db = getDb();
  const since = new Date(Date.now() - lookbackDays * 86_400_000);
  const rows = await db.select().from(economicWatchDiagnostics).where(gte(economicWatchDiagnostics.occurredAt, since));
  const counts: DiagnosticCounts = { missing_forecast: 0, missing_actual: 0, duplicate_event: 0, normalization_failure: 0, missing_revision: 0 };
  for (const r of rows) counts[r.kind as WatchDiagnosticKind]++;
  return counts;
}
