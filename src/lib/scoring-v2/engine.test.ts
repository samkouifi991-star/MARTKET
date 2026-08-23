import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/pipeline/technical");
vi.mock("@/lib/pipeline/seasonality");
vi.mock("@/lib/pipeline/positioning");
vi.mock("@/lib/pipeline/sentiment");
vi.mock("@/lib/pipeline/macro");
vi.mock("@/lib/pipeline/news");
vi.mock("@/lib/pipeline/scoring-config");
vi.mock("@/services/market-data/last-known-good");
vi.mock("@/db/queries/scores");
vi.mock("@/db/queries/scoring-v2");
vi.mock("@/db/queries/economic-releases");

import { resolveTechnicalFactor } from "@/lib/pipeline/technical";
import { resolveSeasonalityFactor } from "@/lib/pipeline/seasonality";
import { resolveInstitutionalFactor } from "@/lib/pipeline/positioning";
import { resolveRetailSentimentFactor } from "@/lib/pipeline/sentiment";
import { resolveEconomicGrowthFactor, resolveInflationFactor, resolveLaborFactor, resolveInterestRatesFactor } from "@/lib/pipeline/macro";
import { resolveNewsFactor } from "@/lib/pipeline/news";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { getCurrentScore } from "@/db/queries/scores";
import { getCurrentScoreV2, upsertCurrentScoreV2, recordScoreHistoryV2, recordShadowComparison, recordIntegrityError } from "@/db/queries/scoring-v2";
import { getRecentEventShocks, getRecentSurprisesForCountries, hasEventShockForRelease, recordEventShock } from "@/db/queries/economic-releases";
import { computeMarketScoreV2 } from "./engine";
import { DEFAULT_SCORING_V2_SETTINGS } from "./config";
import { ResolvedFactor } from "@/lib/pipeline/types";

function neutralFactor(key: ResolvedFactor["key"]): ResolvedFactor {
  return { key, rawScore: 0, explanation: "neutral", source: "test", provider: "fmp", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() };
}

function mockAllFactorsNeutral() {
  vi.mocked(resolveTechnicalFactor).mockResolvedValue(neutralFactor("technical"));
  vi.mocked(resolveSeasonalityFactor).mockResolvedValue(neutralFactor("seasonality"));
  vi.mocked(resolveInstitutionalFactor).mockResolvedValue(neutralFactor("institutional"));
  vi.mocked(resolveRetailSentimentFactor).mockResolvedValue(neutralFactor("retailSentiment"));
  vi.mocked(resolveEconomicGrowthFactor).mockResolvedValue(neutralFactor("economicGrowth"));
  vi.mocked(resolveInflationFactor).mockResolvedValue(neutralFactor("inflation"));
  vi.mocked(resolveLaborFactor).mockResolvedValue(neutralFactor("labor"));
  vi.mocked(resolveInterestRatesFactor).mockResolvedValue(neutralFactor("interestRates"));
  vi.mocked(resolveNewsFactor).mockResolvedValue(neutralFactor("news"));
}

function mockNoFredData() {
  vi.mocked(getFredSeriesWithFallback).mockResolvedValue({ provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null });
}

function mockDefaultConfig() {
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
}

describe("computeMarketScoreV2", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAllFactorsNeutral();
    mockNoFredData();
    mockDefaultConfig();
    vi.mocked(getCurrentScoreV2).mockResolvedValue(null);
    vi.mocked(getCurrentScore).mockResolvedValue(null);
    vi.mocked(getRecentEventShocks).mockResolvedValue([]);
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);
    vi.mocked(hasEventShockForRelease).mockResolvedValue(false);
    vi.mocked(recordEventShock).mockResolvedValue(undefined);
    vi.mocked(upsertCurrentScoreV2).mockResolvedValue(undefined);
    vi.mocked(recordScoreHistoryV2).mockResolvedValue(undefined);
    vi.mocked(recordShadowComparison).mockResolvedValue(undefined);
    vi.mocked(recordIntegrityError).mockResolvedValue(undefined);
  });

  it("computes a neutral, valid score when every underlying factor is neutral and no surprises exist", async () => {
    const result = await computeMarketScoreV2("XAUUSD", "live");
    expect(result.totalScore).toBe(0);
    expect(result.bias).toBe("Neutral");
    expect(result.factors.map((f) => f.key as string)).toContain("event");
    const eventFactor = result.factors.find((f) => (f.key as string) === "event");
    expect(eventFactor?.contribution).toBe(0);
  });

  it("guarantees the total equals the sum of visible factor contributions (requirement #1's core invariant)", async () => {
    vi.mocked(resolveTechnicalFactor).mockResolvedValue({ ...neutralFactor("technical"), rawScore: 5 });
    const result = await computeMarketScoreV2("XAUUSD", "live");
    const sum = Number(result.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
    expect(Math.abs(result.totalScore - sum)).toBeLessThanOrEqual(0.02);
  });

  it("detects a new CPI surprise for Gold, records an event shock, and reflects it as a bullish contribution (hot CPI is initially bullish for gold)", async () => {
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([{ id: 42, indicatorKey: "cpi", country: "US", actual: 0.4, forecast: 0.2, surpriseZ: 2.0, importanceTier: "HIGH", releaseDateTime: new Date().toISOString() }]);
    // Once detectAndRecordNewShocks creates the shock, the subsequent
    // getRecentEventShocks read (the one call engine.ts actually makes)
    // should see it as an active shock for this cycle's contribution.
    vi.mocked(getRecentEventShocks).mockResolvedValue([{ symbol: "XAUUSD", factorKey: "inflation", initialContribution: 2.0, importanceTier: "HIGH", occurredAt: new Date().toISOString() }]);

    const result = await computeMarketScoreV2("XAUUSD", "live");

    expect(recordEventShock).toHaveBeenCalledWith(expect.objectContaining({ symbol: "XAUUSD", sourceReleaseId: 42, factorKey: "inflation" }));
    const inflationFactor = result.factors.find((f) => f.key === "inflation");
    expect(inflationFactor!.contribution).toBeGreaterThan(0);
  });

  it("never re-processes a surprise that already has a recorded shock for this symbol (idempotency)", async () => {
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([{ id: 42, indicatorKey: "cpi", country: "US", actual: 0.4, forecast: 0.2, surpriseZ: 2.0, importanceTier: "HIGH", releaseDateTime: new Date().toISOString() }]);
    vi.mocked(hasEventShockForRelease).mockResolvedValue(true);

    await computeMarketScoreV2("XAUUSD", "live");

    expect(recordEventShock).not.toHaveBeenCalled();
  });

  it("keeps the previous canonical V2 score and records an integrity error instead of publishing a broken calculation", async () => {
    vi.mocked(resolveTechnicalFactor).mockResolvedValue({ ...neutralFactor("technical"), rawScore: NaN });
    vi.mocked(getCurrentScoreV2).mockResolvedValue({
      symbol: "XAUUSD",
      totalScore: 2.5,
      rawScore: 2.5,
      bias: "Bullish",
      confidence: 70,
      change24h: 0,
      factors: [],
      history: [],
      lastUpdated: new Date().toISOString(),
    });

    const result = await computeMarketScoreV2("XAUUSD", "live");

    expect(result.totalScore).toBe(2.5); // the previous canonical score, untouched
    expect(recordIntegrityError).toHaveBeenCalled();
  });

  it("persists to the current V2 tables and records a shadow comparison against V1 when options.persist is true", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue({ symbol: "XAUUSD", totalScore: 1.0, bias: "Neutral", confidence: 55, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString() });

    await computeMarketScoreV2("XAUUSD", "live", { persist: true });

    expect(upsertCurrentScoreV2).toHaveBeenCalled();
    expect(recordShadowComparison).toHaveBeenCalledWith(expect.objectContaining({ symbol: "XAUUSD", v1Score: 1.0, v1Bias: "Neutral" }));
  });

  it("skips writing a history observation for an immaterial change (no bias change, delta below the 0.25 threshold, no HIGH event)", async () => {
    vi.mocked(getCurrentScoreV2).mockResolvedValue({ symbol: "XAUUSD", totalScore: 0.1, rawScore: 0.1, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString() });

    await computeMarketScoreV2("XAUUSD", "live", { persist: true });

    expect(recordScoreHistoryV2).not.toHaveBeenCalled();
  });

  it("writes a history observation when the bias changes, even accounting for smoothing and family caps pulling the new value back", async () => {
    // Smoothing (default alpha 0.5) blends the raw contribution with the
    // previous smoothed score, and the default Technical family cap (4)
    // limits how much technical alone can contribute — so this pushes two
    // different families (Technical + Macro) to jointly clear the Bullish
    // entry threshold (4) starting from a previous score of 3.5, isolating
    // "did the bias-change history rule fire" from single-factor realism.
    vi.mocked(resolveTechnicalFactor).mockResolvedValue({ ...neutralFactor("technical"), rawScore: 25 }); // capped at the Technical family's max (4)
    vi.mocked(resolveEconomicGrowthFactor).mockResolvedValue({ ...neutralFactor("economicGrowth"), rawScore: 50 }); // capped at the Macro family's max (6)
    vi.mocked(getCurrentScoreV2).mockResolvedValue({ symbol: "XAUUSD", totalScore: 3.5, rawScore: 3.5, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString() });

    await computeMarketScoreV2("XAUUSD", "live", { persist: true });

    expect(recordScoreHistoryV2).toHaveBeenCalled();
  });
});
