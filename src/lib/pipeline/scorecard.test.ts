import { describe, expect, it, vi, beforeEach } from "vitest";
import { Instrument, MarketScore, ScoreFactor, ScoreFactorKey } from "@/lib/types";
import { CardResult } from "./types";
import { InstitutionalCardData, LiveMarketDetail } from "./market-detail";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";

vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/release-tracking");
vi.mock("@/db/queries/economic-releases");
vi.mock("@/services/market-data/last-known-good");
vi.mock("./gold-macro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gold-macro")>();
  return { ...actual, computeGoldMacroRegime: vi.fn() };
});

import { getLatestEconomicEventByIndicator } from "@/db/queries/market-data";
import { getRecentReleaseTracking, ReleaseTrackingRow } from "@/db/queries/release-tracking";
import { getSurpriseById, SurpriseRow } from "@/db/queries/economic-releases";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { computeGoldMacroRegime } from "./gold-macro";
import { buildScorecardData } from "./scorecard";

const GOLD: Instrument = { symbol: "XAUUSD", name: "Gold", assetClass: "Commodities", decimals: 2 };
const GBPUSD: Instrument = { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "Forex", currencies: ["GBP", "USD"], decimals: 4 };

const ALL_FACTOR_KEYS: ScoreFactorKey[] = ["institutional", "retailSentiment", "technical", "seasonality", "economicGrowth", "inflation", "labor", "interestRates", "news"];

function fixtureFactor(key: ScoreFactorKey, contribution: number): ScoreFactor {
  return { key, contribution, rawScore: contribution, weight: 1, explanation: `${key} explanation`, source: `${key} source`, provider: "fred", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() };
}

function fixtureScore(contributions: Partial<Record<ScoreFactorKey, number>>): MarketScore {
  const factors = ALL_FACTOR_KEYS.map((k) => fixtureFactor(k, contributions[k] ?? 0));
  const totalScore = Number(factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  return { symbol: "XAUUSD", totalScore, bias: "Neutral", confidence: 80, change24h: 0, factors, history: [], lastUpdated: new Date().toISOString() };
}

function emptyCard<T>(): CardResult<T> {
  return { data: null, freshness: "unavailable", source: "test", lastUpdated: null, reason: "test fixture" };
}

function fixtureLiveDetail(overrides: Partial<LiveMarketDetail> = {}): LiveMarketDetail {
  return {
    price: emptyCard(),
    institutional: emptyCard<InstitutionalCardData>(),
    retail: emptyCard<NormalizedRetailSentiment>(),
    smartMoney: emptyCard(),
    seasonality: emptyCard(),
    ...overrides,
  };
}

function fixtureReleaseTrackingRow(overrides: Partial<ReleaseTrackingRow> = {}): ReleaseTrackingRow {
  return {
    id: 1,
    releaseKey: "fmp:US:cpi:2027-01-01T13:30:00.000Z",
    provider: "fmp",
    country: "US",
    indicatorKey: "cpi",
    rawEvent: "CPI YoY",
    importanceTier: "HIGH",
    scheduledAt: "2027-01-01T13:30:00.000Z",
    state: "processed",
    forecast: 3.2,
    previous: 3.1,
    actual: 3.4,
    revisedPrevious: null,
    firstDetectedAt: "2027-01-01T13:31:00.000Z",
    processedAt: "2027-01-01T13:35:00.000Z",
    lastRevisedAt: null,
    surpriseId: 1,
    affectedMarkets: ["XAUUSD", "EURUSD"],
    ...overrides,
  };
}

function fixtureSurpriseRow(overrides: Partial<SurpriseRow> = {}): SurpriseRow {
  return {
    id: 1,
    indicatorKey: "cpi",
    country: "US",
    releaseDateTime: "2027-01-01T13:30:00.000Z",
    actual: 3.4,
    forecast: 3.2,
    previous: 3.1,
    revisedPrevious: null,
    surprise: 0.2,
    surpriseZ: 1.1,
    effectiveSurprise: 0.2,
    importanceTier: "HIGH",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getLatestEconomicEventByIndicator).mockResolvedValue(null);
  vi.mocked(getRecentReleaseTracking).mockResolvedValue([]);
  vi.mocked(getSurpriseById).mockResolvedValue(null);
  vi.mocked(getFredSeriesWithFallback).mockResolvedValue({
    provider: "fred",
    source: "FRED",
    status: "unavailable",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    nextExpectedUpdate: null,
    value: null,
  });
  vi.mocked(computeGoldMacroRegime).mockResolvedValue({
    interestRatesRaw: 0,
    interestRatesExplanation: "unavailable",
    interestRatesFreshness: "unavailable",
    inflationRaw: 0,
    inflationExplanation: "unavailable",
    inflationFreshness: "unavailable",
    drivers: [],
  });
});

describe("buildScorecardData — sub-scores", () => {
  it("technical + sentimentPositioning + fundamentals sums exactly to score.totalScore (requirement #5, extended)", async () => {
    const score = fixtureScore({ institutional: 1.2, retailSentiment: -0.8, technical: 2.5, seasonality: 0.3, economicGrowth: -1.1, inflation: 0.6, labor: -0.2, interestRates: 1.4, news: -0.3 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    const sum = data.subScores.technical + data.subScores.sentimentPositioning + data.subScores.fundamentals;
    expect(sum).toBeCloseTo(score.totalScore, 8);
  });

  it("groups technical+seasonality, institutional+retailSentiment, and the remaining 5 fundamentals factors correctly", async () => {
    const score = fixtureScore({ technical: 2, seasonality: 1, institutional: 3, retailSentiment: -1, economicGrowth: 1, inflation: 1, labor: 1, interestRates: 1, news: 1 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.subScores.technical).toBeCloseTo(3);
    expect(data.subScores.sentimentPositioning).toBeCloseTo(2);
    expect(data.subScores.fundamentals).toBeCloseTo(5);
  });
});

describe("buildScorecardData — institutional vs retail sentiment stay distinct sections", () => {
  it("CFTC positioning (institutional) and retail sentiment are separately keyed, never merged", async () => {
    const institutional: CardResult<InstitutionalCardData> = {
      data: { classification: "Non-Commercial", netPositioning: 12000, netWeeklyChange: 500, pctLong: 60, pctShort: 40, openInterest: 50000, percentile: 70, direction: "Bullish", strength: "Moderate", reportDate: "2027-01-01" },
      freshness: "live",
      source: "CFTC Traders in Financial Futures",
      lastUpdated: new Date().toISOString(),
    };
    const live = fixtureLiveDetail({ institutional });
    const data = await buildScorecardData(GOLD, fixtureScore({}), live);
    expect(data.institutional.data).toEqual(institutional.data);
    expect(data.institutional.source).toBe("CFTC Traders in Financial Futures");
    expect(data.retail).not.toBe(data.institutional);
    expect(data.retail.data).toBeNull();
  });

  it("OANDA FX retail sentiment renders correctly (pass-through of real data)", async () => {
    const retail: CardResult<NormalizedRetailSentiment> = {
      data: { symbol: "GBPUSD", pctLong: 63, pctShort: 37 },
      freshness: "live",
      source: "OANDA PositionBook",
      lastUpdated: new Date().toISOString(),
    };
    const live = fixtureLiveDetail({ retail });
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), live);
    expect(data.retail.data).toEqual({ symbol: "GBPUSD", pctLong: 63, pctShort: 37 });
    expect(data.retail.source).toBe("OANDA PositionBook");
  });

  it("Gold retail sentiment stays honestly unavailable — never substituted with CFTC data", async () => {
    const live = fixtureLiveDetail({ retail: { data: null, freshness: "not_applicable", source: "Retail Sentiment", lastUpdated: null, reason: "No retail-sentiment provider (OANDA/IG/Myfxbook) covers XAUUSD" } });
    const data = await buildScorecardData(GOLD, fixtureScore({}), live);
    expect(data.retail.data).toBeNull();
    expect(data.retail.freshness).toBe("not_applicable");
    expect(data.retail.reason).toMatch(/No retail-sentiment provider/);
  });
});

describe("buildScorecardData — Growth/Inflation/Jobs rows never fabricate", () => {
  it("a fixture with forecast: null never gets a Bullish/Bearish classification, and surprise is null", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockImplementation(async (_country, key) => {
      if (key === "gdp") return { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: null, importanceTier: "HIGH" };
      return null;
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("calendar");
    if (data.economicGrowth.kind !== "calendar") throw new Error("unreachable");
    const gdpRow = data.economicGrowth.rows.find((r) => r.indicatorKey === "gdp");
    expect(gdpRow).toBeDefined();
    expect(gdpRow!.classification).toBeNull();
    expect(gdpRow!.forecast).toBeNull();
    expect(gdpRow!.surprise).toBeNull();
    expect(gdpRow!.actual).toBe(2.1);
  });

  it("falls back to 'unavailable' (never a fabricated stub) when neither the calendar nor FRED has any real data for this country", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockResolvedValue(null);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("unavailable");
    expect(data.inflation.kind).toBe("unavailable");
    expect(data.jobsMarket.kind).toBe("unavailable");
  });

  it("classifies a real actual+forecast pair, inverted for gold on a growth beat", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockImplementation(async (_country, key) => {
      if (key === "gdp") return { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 3.0, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" };
      return null;
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.economicGrowth.kind !== "calendar") throw new Error("unreachable");
    const gdpRow = data.economicGrowth.rows.find((r) => r.indicatorKey === "gdp")!;
    expect(gdpRow.classification).toBe("Bearish");
    expect(gdpRow.surprise).toBeCloseTo(1.0);
  });

  it("falls back to the secondary indicatorKey when the primary has no stored release yet", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockImplementation(async (_country, key) => {
      if (key === "ismManufacturing") return null;
      if (key === "spGlobalManufacturingPmi") return { event: "S&P Global Manufacturing PMI", dateTime: "2027-02-01T00:00:00.000Z", actual: 51.2, previous: 50.8, forecast: 50.9, importanceTier: "MEDIUM" };
      return null;
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.economicGrowth.kind !== "calendar") throw new Error("unreachable");
    const pmiRow = data.economicGrowth.rows.find((r) => r.label === "Manufacturing PMI")!;
    expect(pmiRow.indicatorKey).toBe("spGlobalManufacturingPmi");
    expect(pmiRow.actual).toBe(51.2);
  });
});

describe("buildScorecardData — Macro State fallback (Phase 3: never leave Growth/Inflation/Jobs blank when the calendar has nothing)", () => {
  function fredSeries(values: number[]): { date: string; value: number }[] {
    return values.map((value, i) => ({ date: `2026-0${i + 1}-01`, value }));
  }

  it("falls back to a real FRED-backed Macro State row for Growth when no calendar release exists", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockResolvedValue(null);
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country, indicator) => ({
      provider: "fred",
      source: "FRED (Federal Reserve Economic Data)",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-03-01",
      nextExpectedUpdate: null,
      value: indicator === "gdpGrowth" ? fredSeries([2.0, 2.2, 2.6]) : null,
    }));
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("macro-state");
    if (data.economicGrowth.kind !== "macro-state") throw new Error("unreachable");
    expect(data.economicGrowth.rows).toHaveLength(1);
    const row = data.economicGrowth.rows[0];
    expect(row.value).toBe(2.6);
    expect(row.previousValue).toBe(2.2);
    expect(row.changeAbs).toBeCloseTo(0.4);
    // Gold: growth accelerating is a headwind (inverted polarity), same
    // convention classifyIndicatorSurprise already applies to a real
    // calendar growth beat.
    expect(row.classification).toBe("Bearish");
    expect(row.source).toBe("FRED (Federal Reserve Economic Data)");
  });

  it("never fabricates a Macro State row when FRED has fewer than 3 real observations either — reports unavailable instead", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockResolvedValue(null);
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-02-01",
      nextExpectedUpdate: null,
      value: fredSeries([2.0, 2.2]),
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("unavailable");
  });

  it("prefers real calendar release rows over the Macro State fallback whenever both exist", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockImplementation(async (_country, key) => {
      if (key === "gdp") return { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" };
      return null;
    });
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-03-01",
      nextExpectedUpdate: null,
      value: fredSeries([2.0, 2.2, 2.6]),
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("calendar");
  });

  it("computes an unemployment-rate Macro State row with jobs-kind polarity (falling unemployment reads Bearish for gold)", async () => {
    vi.mocked(getLatestEconomicEventByIndicator).mockResolvedValue(null);
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country, indicator) => ({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-03-01",
      nextExpectedUpdate: null,
      value: indicator === "unemploymentRate" ? fredSeries([4.2, 4.0, 3.8]) : null,
    }));
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.jobsMarket.kind).toBe("macro-state");
    if (data.jobsMarket.kind !== "macro-state") throw new Error("unreachable");
    expect(data.jobsMarket.rows[0].classification).toBe("Bearish"); // falling unemployment = stronger economy = bearish for gold
  });
});

describe("buildScorecardData — 'Why this score?' driver attribution (Phase 7)", () => {
  it("splits factors into positive and negative drivers, sorted by contribution magnitude, using the same real contribution numbers already on score.factors", async () => {
    const score = fixtureScore({ technical: 2.5, institutional: 1.2, seasonality: 0.3, retailSentiment: -3.0, inflation: -0.5, economicGrowth: 0 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.scoreDrivers.positive.map((d) => d.key)).toEqual(["technical", "institutional", "seasonality"]);
    expect(data.scoreDrivers.positive[0].contribution).toBe(2.5);
    expect(data.scoreDrivers.negative.map((d) => d.key)).toEqual(["retailSentiment", "inflation"]);
    expect(data.scoreDrivers.negative[0].contribution).toBe(-3.0);
  });

  it("excludes a factor with exactly zero contribution from both lists — it isn't driving the score in either direction", async () => {
    const score = fixtureScore({ technical: 1, news: 0 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.scoreDrivers.positive.some((d) => d.key === "news")).toBe(false);
    expect(data.scoreDrivers.negative.some((d) => d.key === "news")).toBe(false);
  });

  it("caps each side to at most 4 drivers even when more factors are non-zero", async () => {
    const score = fixtureScore({ technical: 5, institutional: 4, seasonality: 3, economicGrowth: 2, interestRates: 1 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.scoreDrivers.positive.length).toBeLessThanOrEqual(4);
  });

  it("reuses the real factor explanation text verbatim — never generates new copy", async () => {
    const score = fixtureScore({ technical: 1 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    const technicalFactor = score.factors.find((f) => f.key === "technical")!;
    const driver = data.scoreDrivers.positive.find((d) => d.key === "technical")!;
    expect(driver.explanation).toBe(technicalFactor.explanation);
  });
});

describe("buildScorecardData — Interest Rates section", () => {
  it("uses Gold's real asset-specific driver breakdown, not a generic policy-rate read", async () => {
    vi.mocked(computeGoldMacroRegime).mockResolvedValue({
      interestRatesRaw: 3.1,
      interestRatesExplanation: "explained",
      interestRatesFreshness: "live",
      inflationRaw: 0,
      inflationExplanation: "unavailable",
      inflationFreshness: "unavailable",
      drivers: [{ label: "2Y yield / Fed-cut expectations (DGS2)", changeValue: -0.15, contribution: 1.2, explanation: "2Y yield fell" }],
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.interestRates.kind).toBe("gold-drivers");
    if (data.interestRates.kind === "gold-drivers") {
      expect(data.interestRates.drivers).toHaveLength(1);
      expect(data.interestRates.freshness).toBe("live");
    }
  });

  it("shows a base-vs-quote policy-rate differential for FX", async () => {
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (country) => ({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: [{ date: "2027-01-01", value: country === "GB" ? 5.25 : 4.5 }],
    }));
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    expect(data.interestRates.kind).toBe("generic");
    if (data.interestRates.kind === "generic") {
      expect(data.interestRates.differential?.data).toEqual({ baseRate: 5.25, quoteRate: 4.5, diffPts: 0.75 });
    }
  });
});

describe("buildScorecardData — Economic Surprise Index (V2 shadow)", () => {
  it("filters release-tracking rows to only this symbol's affected markets", async () => {
    vi.mocked(getRecentReleaseTracking).mockResolvedValue([
      fixtureReleaseTrackingRow({ affectedMarkets: ["XAUUSD"], surpriseId: 1 }),
      fixtureReleaseTrackingRow({ id: 2, affectedMarkets: ["USDJPY"], surpriseId: 2 }),
    ]);
    vi.mocked(getSurpriseById).mockImplementation(async (id) => fixtureSurpriseRow({ id }));
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.surpriseIndex.rows).toHaveLength(1);
  });

  it("labels the section limited when there's not much real V2 history yet (expected today)", async () => {
    vi.mocked(getRecentReleaseTracking).mockResolvedValue([]);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.surpriseIndex.rows).toHaveLength(0);
    expect(data.surpriseIndex.limited).toBe(true);
  });

  it("never invents a row when a tracking row's surprise cannot be found", async () => {
    vi.mocked(getRecentReleaseTracking).mockResolvedValue([fixtureReleaseTrackingRow({ affectedMarkets: ["XAUUSD"], surpriseId: 99 })]);
    vi.mocked(getSurpriseById).mockResolvedValue(null);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.surpriseIndex.rows).toHaveLength(0);
  });
});

describe("buildScorecardData — Technicals section reuses score.factors, no new fetch", () => {
  it("derives Technicals rows directly from the technical/seasonality factor contributions", async () => {
    const score = fixtureScore({ technical: 3, seasonality: -2 });
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.technicals.find((r) => r.label === "4H / Daily Chart Trend")?.classification).toBe("Bullish");
    expect(data.technicals.find((r) => r.label === "Seasonality Trend")?.classification).toBe("Bearish");
  });
});
