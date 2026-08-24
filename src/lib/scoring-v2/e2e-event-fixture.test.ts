// A single, controlled end-to-end fixture proving the full chain the user
// asked for: release -> surprise -> affected-market recomputation -> V2
// history -> attribution — without ever writing to a V1 table.
//
// Real, unmocked code paths exercised: services/economic-calendar/
// release-identity.ts (releaseKeyFor), lib/scoring-v2/release-watch.ts
// (processReleases), lib/scoring-v2/economic-surprise.ts (the actual
// surprise/z-score math), lib/scoring-v2/engine.ts (computeMarketScoreV2 —
// shock detection, family caps, smoothing, hysteresis, integrity), and
// lib/scoring-v2/attribution.ts (computeScoreChangeAttribution).
//
// Only three kinds of things are replaced: V1's live factor resolvers
// (fixed neutral baselines — no live provider calls in a test), V1's own
// score READ (getCurrentScore, mocked to null — used only for the shadow-
// comparison row), and the V2 persistence layer, which is backed by real
// in-memory stores with genuine semantics (not empty stubs) rather than
// the real Postgres driver, so this test needs no database.
//
// The synthetic release itself (a hot US CPI print) and its 4-point
// historical baseline are clearly-labeled test fixtures, not a claim about
// any real economic event — this file never asserts anything about real
// market history.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/pipeline/technical");
vi.mock("@/lib/pipeline/seasonality");
vi.mock("@/lib/pipeline/positioning");
vi.mock("@/lib/pipeline/sentiment");
vi.mock("@/lib/pipeline/macro");
vi.mock("@/lib/pipeline/news");
vi.mock("@/lib/pipeline/scoring-config");
vi.mock("@/services/market-data/last-known-good");
vi.mock("@/db/queries/scores"); // V1 — asserted below to NEVER be written to
vi.mock("@/db/queries/market-data", () => ({ updateEconomicEventClassification: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/db/queries/release-tracking", () => ({ upsertReleaseTracking: vi.fn().mockResolvedValue({ row: null, transition: "created_released" }), markReleaseProcessed: vi.fn().mockResolvedValue(undefined) }));

// Real in-memory persistence for V2's own tables — genuine semantics
// (idempotency, filtering, ordering), not the Postgres driver. Shared
// across processReleases (release-watch.ts) and engine.ts, exactly like
// the real economic_release_surprises/event_shocks tables are shared.
vi.mock("@/db/queries/economic-releases", () => {
  type Surprise = { id: number; indicatorKey: string; country: string; releaseDateTime: string; actual: number; forecast: number | null; surpriseZ: number | null; importanceTier: string; releaseKey: string };
  type Shock = { symbol: string; factorKey: string | null; sourceReleaseId: number | null; initialContribution: number; importanceTier: string; occurredAt: string };
  const surprises: Surprise[] = [];
  const shocks: Shock[] = [];
  let nextId = 1;

  return {
    recordReleaseSurprise: vi.fn(async (input: Omit<Surprise, "id">) => {
      const id = nextId++;
      surprises.push({ ...input, id });
      return id;
    }),
    hasProcessedReleaseKey: vi.fn(async (releaseKey: string) => surprises.some((s) => s.releaseKey === releaseKey)),
    // Seeded low-variance historical baseline so a real z-score is
    // computable — economic-surprise.ts's own MIN_SAMPLE_FOR_NORMALIZATION
    // requires at least 4 real observations before normalizing at all.
    getHistoricalEffectiveSurprises: vi.fn(async () => [0.0, 0.05, -0.02, 0.03]),
    recordEventShock: vi.fn(async (input: Omit<Shock, "occurredAt">) => {
      shocks.push({ ...input, occurredAt: new Date().toISOString() });
    }),
    hasEventShockForRelease: vi.fn(async (symbol: string, sourceReleaseId: number) => shocks.some((s) => s.symbol === symbol && s.sourceReleaseId === sourceReleaseId)),
    getRecentSurprisesForCountries: vi.fn(async (countries: string[]) =>
      surprises.filter((s) => countries.includes(s.country)).map((s) => ({ id: s.id, indicatorKey: s.indicatorKey, country: s.country, actual: s.actual, forecast: s.forecast, surpriseZ: s.surpriseZ, importanceTier: s.importanceTier, releaseDateTime: s.releaseDateTime }))
    ),
    getRecentEventShocks: vi.fn(async (symbol: string) => shocks.filter((s) => s.symbol === symbol)),
    recordWatchDiagnostic: vi.fn(async () => {}),
    hasDiagnostic: vi.fn(async () => false),
  };
});

vi.mock("@/db/queries/scoring-v2", () => {
  type Snapshot = { symbol: string; totalScore: number; rawScore: number; bias: string; confidence: number; change24h: number; factors: unknown[]; lastUpdated: string };
  const current = new Map<string, Snapshot>();
  const factorSnapshots: { symbol: string; computedAt: string; factors: { key: string; contribution: number; explanation: string }[] }[] = [];
  const shadowComparisons: unknown[] = [];

  return {
    getCurrentScoreV2: vi.fn(async (symbol: string) => current.get(symbol) ?? null),
    upsertCurrentScoreV2: vi.fn(async (score: Snapshot) => {
      current.set(score.symbol, score);
    }),
    recordScoreHistoryV2: vi.fn(async (score: Snapshot) => {
      factorSnapshots.push({ symbol: score.symbol, computedAt: score.lastUpdated, factors: score.factors as { key: string; contribution: number; explanation: string }[] });
    }),
    recordShadowComparison: vi.fn(async (input: unknown) => {
      shadowComparisons.push(input);
    }),
    recordIntegrityError: vi.fn(async () => {}),
    getRecentFactorScoreV2Snapshots: vi.fn(async (symbol: string, limit = 2) =>
      factorSnapshots
        .filter((s) => s.symbol === symbol)
        .sort((a, b) => (a.computedAt < b.computedAt ? 1 : -1))
        .slice(0, limit)
        .map(({ computedAt, factors }) => ({ computedAt, factors }))
    ),
  };
});

import { resolveTechnicalFactor } from "@/lib/pipeline/technical";
import { resolveSeasonalityFactor } from "@/lib/pipeline/seasonality";
import { resolveInstitutionalFactor } from "@/lib/pipeline/positioning";
import { resolveRetailSentimentFactor } from "@/lib/pipeline/sentiment";
import { resolveEconomicGrowthFactor, resolveInflationFactor, resolveLaborFactor, resolveInterestRatesFactor } from "@/lib/pipeline/macro";
import { resolveNewsFactor } from "@/lib/pipeline/news";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { getCurrentScore, upsertCurrentScore, recordScoreHistory } from "@/db/queries/scores";
import { recordEventShock } from "@/db/queries/economic-releases";
import { recordScoreHistoryV2 } from "@/db/queries/scoring-v2";
import { computeMarketScoreV2 } from "./engine";
import { processReleases } from "./release-watch";
import { computeScoreChangeAttribution } from "./attribution";
import { DEFAULT_SCORING_V2_SETTINGS } from "./config";
import { releaseKeyFor } from "@/services/economic-calendar/release-identity";
import { EconomicRelease } from "@/services/economic-calendar/provider";
import { ResolvedFactor } from "@/lib/pipeline/types";

function neutralFactor(key: ResolvedFactor["key"]): ResolvedFactor {
  return { key, rawScore: 0, explanation: "neutral baseline (test fixture)", source: "test", provider: "fmp", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() };
}

describe("end-to-end: economic release -> surprise -> targeted recompute -> V2 history -> attribution", () => {
  beforeEach(() => {
    // clearAllMocks (not resetAllMocks) — this file's economic-releases/
    // scoring-v2/release-tracking/market-data mocks carry real
    // implementations set once in their vi.mock factories above; reset
    // would wipe those back to an undefined-returning stub.
    vi.clearAllMocks();
    vi.mocked(resolveTechnicalFactor).mockResolvedValue(neutralFactor("technical"));
    vi.mocked(resolveSeasonalityFactor).mockResolvedValue(neutralFactor("seasonality"));
    vi.mocked(resolveInstitutionalFactor).mockResolvedValue(neutralFactor("institutional"));
    vi.mocked(resolveRetailSentimentFactor).mockResolvedValue(neutralFactor("retailSentiment"));
    vi.mocked(resolveEconomicGrowthFactor).mockResolvedValue(neutralFactor("economicGrowth"));
    vi.mocked(resolveInflationFactor).mockResolvedValue(neutralFactor("inflation"));
    vi.mocked(resolveLaborFactor).mockResolvedValue(neutralFactor("labor"));
    vi.mocked(resolveInterestRatesFactor).mockResolvedValue(neutralFactor("interestRates"));
    vi.mocked(resolveNewsFactor).mockResolvedValue(neutralFactor("news"));
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue({ provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null });
    vi.mocked(resolveActiveScoringConfig).mockResolvedValue({
      id: 1,
      weights: { institutional: 0.15, retailSentiment: 0.1, technical: 0.2, seasonality: 0.05, economicGrowth: 0.12, inflation: 0.1, labor: 0.08, interestRates: 0.13, news: 0.07 },
      biasThresholds: [
        { bias: "Very Bullish", min: 8 },
        { bias: "Bullish", min: 4 },
        { bias: "Neutral", min: -3.9 },
        { bias: "Bearish", min: -7.9 },
        { bias: "Very Bearish", min: -10 },
      ],
      v2Settings: DEFAULT_SCORING_V2_SETTINGS,
    });
    vi.mocked(getCurrentScore).mockResolvedValue(null);
    vi.useFakeTimers();
  });

  it("moves GBPUSD's V2 score on a hot US CPI surprise, records real history, and attributes it to the event shock — while never writing to any V1 table", async () => {
    // --- Cycle 1: baseline, before any release. Every V1 factor is a flat
    // neutral fixture, so the baseline score is exactly 0 / Neutral.
    vi.setSystemTime(new Date("2027-06-01T08:00:00.000Z"));
    const baseline = await computeMarketScoreV2("GBPUSD", "live", { persist: true });
    expect(baseline.totalScore).toBe(0);
    expect(baseline.factors.find((f) => (f.key as string) === "event")?.contribution).toBe(0);

    // --- A real US CPI release comes in, well above forecast.
    vi.setSystemTime(new Date("2027-06-01T12:15:00.000Z"));
    const releaseDateTime = "2027-06-01T12:15:00.000Z";
    const releaseKey = releaseKeyFor("fmp", "US", "cpi", releaseDateTime);
    const release: EconomicRelease = {
      id: "fmp-US-CPI-fixture-0",
      country: "United States",
      event: "CPI m/m",
      indicatorKey: "cpi",
      importanceTier: "HIGH",
      releaseKey,
      dateTime: releaseDateTime,
      actual: 0.5,
      forecast: 0.2,
      previous: 0.2,
      revisedPrevious: null,
    };

    const watchResult = await processReleases([release]);
    expect(watchResult.processed).toEqual([{ releaseKey, country: "US", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 1 }]);
    expect(watchResult.failCount).toBe(0);

    // Idempotency (requirement #2): re-processing the identical release
    // must not create a second surprise.
    const secondPoll = await processReleases([release]);
    expect(secondPoll.processed).toHaveLength(0);
    expect(secondPoll.skippedCount).toBe(1);

    // --- Cycle 2: recompute GBPUSD (the watch route's targeted recompute,
    // called directly here since this fixture focuses on the scoring
    // chain). A hot US CPI surprise is USD-bullish, hence GBP/USD-bearish
    // (base=GBP, quote=USD) — the FX relative-economics shock applies to
    // the total score directly (factorKey null), so it surfaces as the
    // visible "event" pseudo-factor.
    vi.setSystemTime(new Date("2027-06-01T12:20:00.000Z"));
    const afterShock = await computeMarketScoreV2("GBPUSD", "live", { persist: true });

    expect(recordEventShock).toHaveBeenCalledTimes(1);
    const shockCall = vi.mocked(recordEventShock).mock.calls[0][0];
    expect(shockCall.sourceReleaseId).toBe(1);
    expect(shockCall.factorKey).toBeNull();
    expect(shockCall.initialContribution).toBeLessThan(0); // bearish for GBPUSD
    expect(shockCall.initialContribution).toBeCloseTo(-3, 1); // clamped to the default event-shock max contribution

    const eventFactor = afterShock.factors.find((f) => (f.key as string) === "event");
    expect(eventFactor).toBeDefined();
    expect(eventFactor!.contribution).toBeLessThan(0);
    expect(afterShock.totalScore).toBeLessThan(baseline.totalScore); // the score genuinely moved, bearish
    expect(afterShock.totalScore).toBeLessThan(-1); // a materially large move, not noise

    // Requirement #1's core invariant still holds even with an event shock present.
    const sum = Number(afterShock.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
    expect(Math.abs(afterShock.totalScore - sum)).toBeLessThanOrEqual(0.02);

    // Requirement #7: a >= 0.25-point move must persist a real history observation.
    expect(recordScoreHistoryV2).toHaveBeenCalledTimes(2); // baseline + this cycle

    // --- Attribution (requirement #8): built entirely from the two real
    // stored factor snapshots, never LLM-invented, and dominated by the
    // event shock this release actually caused.
    const attribution = await computeScoreChangeAttribution("GBPUSD");
    expect(attribution).not.toBeNull();
    expect(attribution!.fromTotal).toBeCloseTo(baseline.totalScore, 5);
    expect(attribution!.toTotal).toBeCloseTo(afterShock.totalScore, 5);
    expect(attribution!.netChange).toBeCloseTo(afterShock.totalScore - baseline.totalScore, 5);

    const dominant = attribution!.items[0]; // sorted by |delta| descending
    expect(dominant.key).toBe("event");
    expect(dominant.delta).toBeLessThan(0);
    expect(Math.abs(dominant.delta)).toBeGreaterThan(Math.abs(attribution!.items[1]?.delta ?? 0));

    // --- V1 is never touched by any of this. getCurrentScore (a V1 READ,
    // used only to populate the shadow-comparison row) is fine to have
    // been called; the two V1 WRITE functions must never be.
    expect(upsertCurrentScore).not.toHaveBeenCalled();
    expect(recordScoreHistory).not.toHaveBeenCalled();
  });
});
