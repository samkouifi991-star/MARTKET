import { describe, expect, it, vi, beforeEach } from "vitest";
import { Instrument, MarketScore, ScoreFactor, ScoreFactorKey } from "@/lib/types";
import { CardResult } from "./types";
import { InstitutionalCardData, LiveMarketDetail } from "./market-detail";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";

vi.mock("@/db/queries/market-data");
vi.mock("@/services/market-data/last-known-good");
vi.mock("./gold-macro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gold-macro")>();
  return { ...actual, computeGoldMacroRegime: vi.fn() };
});
vi.mock("./forex-scorecard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./forex-scorecard")>();
  return { ...actual, buildForexScorecard: vi.fn() };
});

import { getLatestEconomicEventsByIndicators, getRecentNews, getUpcomingHighImpactEvents, StoredEconomicEventRow } from "@/db/queries/market-data";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { computeGoldMacroRegime } from "./gold-macro";
import { buildForexScorecard } from "./forex-scorecard";
import { buildScorecardData, cotChangeLabel } from "./scorecard";

// Builds the Map getLatestEconomicEventsByIndicators returns, keyed
// "country:indicatorKey" — mirrors exactly what buildScorecardData's one
// batched read produces, so a test only has to say which (country,
// indicatorKey) pairs have a real stored release.
function eventsMap(entries: Record<string, Omit<StoredEconomicEventRow, "revisedPrevious"> & { revisedPrevious?: number | null }>): Map<string, StoredEconomicEventRow> {
  return new Map(Object.entries(entries).map(([key, row]) => [key, { revisedPrevious: null, ...row }]));
}

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

beforeEach(() => {
  vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(new Map());
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
  // News & Market Context (resolveNewsContext) and Currency Comparison
  // (resolveCurrencyComparison) both run unconditionally inside
  // buildScorecardData now — defaulted here so every existing test in this
  // file (none of which exercise those two additions directly) doesn't
  // have to know about them. buildForexScorecard itself never returns
  // null (see forex-scorecard.ts) — an all-fields-unavailable stub is the
  // honest "nothing real to show yet" shape, matching what the real
  // function returns when none of its underlying reads have data.
  vi.mocked(getRecentNews).mockResolvedValue([]);
  vi.mocked(getUpcomingHighImpactEvents).mockResolvedValue([]);
  vi.mocked(buildForexScorecard).mockResolvedValue({
    symbol: "GBPUSD",
    base: "GBP",
    quote: "USD",
    baseStrength: { currency: "GBP", country: "GB", score: null, level: null, drivers: [], freshness: "unavailable" },
    quoteStrength: { currency: "USD", country: "US", score: null, level: null, drivers: [], freshness: "unavailable" },
    strengthDifferential: null,
    baseRate: null,
    quoteRate: null,
    rateDifferentialPts: null,
    surpriseDifferential: null,
    baseSurprise: null,
    quoteSurprise: null,
    baseGrowthContribution: null,
    quoteGrowthContribution: null,
    growthDifferential: null,
    baseLaborContribution: null,
    quoteLaborContribution: null,
    laborDifferential: null,
    dailyTrend: null,
    h4Trend: null,
    h1Trend: null,
    technicalFreshness: null,
    retail: null,
    finalScore: null,
    finalBias: null,
    strengthBand: null,
    rateBand: null,
    surpriseBand: null,
    growthBand: null,
    laborBand: null,
    narrative: null,
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
      data: { classification: "Non-Commercial", longContracts: 30000, shortContracts: 20000, netPositioning: 12000, netWeeklyChange: 500, pctLong: 60, pctShort: 40, openInterest: 50000, percentile: 70, direction: "Bullish", strength: "Moderate", reportDate: "2027-01-01" },
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

// A category's IndicatorSection is now { kind: "rows", rows: IndicatorSectionRow[] }
// — each row independently tagged source: "calendar" | "macro-state" — or
// { kind: "unavailable" } only when NEITHER source has anything. These
// helpers keep the tests below readable.
function calendarRow(section: import("./scorecard").IndicatorSection, indicatorKey: string) {
  if (section.kind !== "rows") throw new Error("expected rows");
  const entry = section.rows.find((r) => r.source === "calendar" && r.row.indicatorKey === indicatorKey);
  return entry?.source === "calendar" ? entry.row : undefined;
}

function macroStateRow(section: import("./scorecard").IndicatorSection, label: string) {
  if (section.kind !== "rows") throw new Error("expected rows");
  const entry = section.rows.find((r) => r.source === "macro-state" && r.row.label === label);
  return entry?.source === "macro-state" ? entry.row : undefined;
}

describe("buildScorecardData — Growth/Inflation/Jobs rows never fabricate", () => {
  it("a fixture with forecast: null never gets a Bullish/Bearish classification, and surprise is null, but Previous still shows", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:gdp": { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: null, importanceTier: "HIGH" } })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("rows");
    const gdpRow = calendarRow(data.economicGrowth, "gdp");
    expect(gdpRow).toBeDefined();
    expect(gdpRow!.classification).toBeNull();
    expect(gdpRow!.forecast).toBeNull();
    expect(gdpRow!.surprise).toBeNull();
    expect(gdpRow!.actual).toBe(2.1);
    expect(gdpRow!.previous).toBe(1.9);
  });

  it("falls back to 'unavailable' (never a fabricated stub) when neither the calendar nor FRED has any real data for this country", async () => {
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowth.kind).toBe("unavailable");
    expect(data.inflation.kind).toBe("unavailable");
    expect(data.jobsMarket.kind).toBe("unavailable");
  });

  it("classifies a real actual+forecast pair, inverted for gold on a growth beat", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:gdp": { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 3.0, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" } })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    const gdpRow = calendarRow(data.economicGrowth, "gdp")!;
    expect(gdpRow.classification).toBe("Bearish");
    expect(gdpRow.surprise).toBeCloseTo(1.0);
  });

  it("falls back to the secondary indicatorKey when the primary has no stored release yet", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:spGlobalManufacturingPmi": { event: "S&P Global Manufacturing PMI", dateTime: "2027-02-01T00:00:00.000Z", actual: 51.2, previous: 50.8, forecast: 50.9, importanceTier: "MEDIUM" } })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    const pmiRow = calendarRow(data.economicGrowth, "spGlobalManufacturingPmi")!;
    expect(pmiRow.actual).toBe(51.2);
  });

  it("shows every stored inflation release, including the newly-added Core PPI and Core PCE rows — never limited to one row", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "US:cpi": { event: "CPI YoY", dateTime: "2027-01-14T00:00:00.000Z", actual: 3.1, previous: 3.2, forecast: 3.0, importanceTier: "HIGH" },
        "US:corePpi": { event: "Core PPI YoY", dateTime: "2027-01-16T00:00:00.000Z", actual: 2.4, previous: 2.5, forecast: 2.3, importanceTier: "MEDIUM" },
        "US:corePce": { event: "Core PCE YoY", dateTime: "2027-01-31T00:00:00.000Z", actual: 2.8, previous: 2.9, forecast: 2.7, importanceTier: "HIGH" },
      })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.inflation.kind !== "rows") throw new Error("expected rows");
    const calendarKeys = data.inflation.rows.filter((r) => r.source === "calendar").map((r) => (r.source === "calendar" ? r.row.indicatorKey : null));
    expect(calendarKeys.sort()).toEqual(["corePce", "corePpi", "cpi"]);
  });

  it("shows Industrial Production (new FRED-backed Growth row) when a verified series exists, without a calendar release", async () => {
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country, indicator) => ({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-07-01",
      nextExpectedUpdate: null,
      value: indicator === "industrialProduction" ? [{ date: "2026-05-01", value: 100 }, { date: "2026-06-01", value: 101 }, { date: "2026-07-01", value: 103 }] : null,
    }));
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    const row = macroStateRow(data.economicGrowth, "Industrial Production");
    expect(row).toBeDefined();
    expect(row!.value).toBe(103);
  });

  it("a category can mix a real calendar release for one indicator with a FRED macro-state row for another, side by side", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:gdp": { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" } })
    );
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-07-01",
      nextExpectedUpdate: null,
      value: [{ date: "2026-05-01", value: 100 }, { date: "2026-06-01", value: 101 }, { date: "2026-07-01", value: 103 }],
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.economicGrowth.kind !== "rows") throw new Error("expected rows");
    expect(calendarRow(data.economicGrowth, "gdp")).toBeDefined();
    expect(macroStateRow(data.economicGrowth, "Retail Sales MoM")).toBeDefined();
    expect(macroStateRow(data.economicGrowth, "Industrial Production")).toBeDefined();
  });

  it("never assigns NFP a FRED fallback — the stored FRED series is a payroll LEVEL, not the monthly change figure traders mean by NFP", async () => {
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-07-01",
      nextExpectedUpdate: null,
      value: [{ date: "2026-05-01", value: 150000 }, { date: "2026-06-01", value: 151000 }, { date: "2026-07-01", value: 152000 }],
    });
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.jobsMarket.kind !== "rows") throw new Error("expected rows");
    expect(data.jobsMarket.rows.some((r) => (r.source === "calendar" ? r.row.indicatorKey === "nfp" : r.row.label === "Non-Farm Payrolls"))).toBe(false);
  });

  it("Labor Force Participation uses non-inverted (growth-like) polarity — rising participation reads the same direction as a growth beat, not like unemployment", async () => {
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country, indicator) => ({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: "2026-07-01",
      nextExpectedUpdate: null,
      value: indicator === "laborParticipation" ? [{ date: "2026-05-01", value: 62.0 }, { date: "2026-06-01", value: 62.2 }, { date: "2026-07-01", value: 62.5 }] : null,
    }));
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    const row = macroStateRow(data.jobsMarket, "Labor Force Participation");
    expect(row).toBeDefined();
    // Rising participation = stronger economy = bearish for gold, the SAME
    // direction a real GDP/growth beat produces — NOT inverted the way
    // unemploymentRate/jobless claims correctly are.
    expect(row!.classification).toBe("Bearish");
  });

  it("reads exactly one batched events query per Scorecard render, not one per indicator", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockClear();
    await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(getLatestEconomicEventsByIndicators).toHaveBeenCalledTimes(1);
  });

  it("never makes a live FRED call from the render path for macro-state rows — always storage-only", async () => {
    vi.mocked(getFredSeriesWithFallback).mockClear();
    await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    const calls = vi.mocked(getFredSeriesWithFallback).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[3]).toBe(true);
  });
});

describe("buildScorecardData — Macro State fallback (Phase 3: never leave Growth/Inflation/Jobs blank when the calendar has nothing)", () => {
  function fredSeries(values: number[]): { date: string; value: number }[] {
    return values.map((value, i) => ({ date: `2026-0${i + 1}-01`, value }));
  }

  it("falls back to a real FRED-backed Macro State row for GDP when no calendar release exists", async () => {
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
    expect(data.economicGrowth.kind).toBe("rows");
    const row = macroStateRow(data.economicGrowth, "GDP Growth QoQ");
    expect(row).toBeDefined();
    expect(row!.value).toBe(2.6);
    expect(row!.previousValue).toBe(2.2);
    expect(row!.changeAbs).toBeCloseTo(0.4);
    // Gold: growth accelerating is a headwind (inverted polarity), same
    // convention classifyIndicatorSurprise already applies to a real
    // calendar growth beat.
    expect(row!.classification).toBe("Bearish");
    expect(row!.source).toBe("FRED (Federal Reserve Economic Data)");
  });

  it("never fabricates a Macro State row when FRED has fewer than 3 real observations either — reports unavailable instead", async () => {
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

  it("prefers a real calendar release over the Macro State fallback for the SAME indicator, even while a sibling indicator in the same category still shows macro-state", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:gdp": { event: "GDP Growth Rate QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" } })
    );
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
    expect(calendarRow(data.economicGrowth, "gdp")).toBeDefined();
    expect(macroStateRow(data.economicGrowth, "GDP Growth QoQ")).toBeUndefined();
    // Retail Sales has no calendar release in this fixture, so it still
    // falls back to its own macro-state row using the same FRED mock.
    expect(macroStateRow(data.economicGrowth, "Retail Sales MoM")).toBeDefined();
  });

  it("computes an unemployment-rate Macro State row with jobs-kind polarity (falling unemployment reads Bearish for gold)", async () => {
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
    const row = macroStateRow(data.jobsMarket, "Unemployment Rate");
    expect(row).toBeDefined();
    expect(row!.classification).toBe("Bearish"); // falling unemployment = stronger economy = bearish for gold
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

describe("buildScorecardData — data-quality/trust summary (Phase 8)", () => {
  it("tallies all 9 factors as live for the default fixture — a pure count, matching score.factors exactly", async () => {
    const score = fixtureScore({});
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.dataQuality.total).toBe(9);
    expect(data.dataQuality.counts.live).toBe(9);
    expect(Object.keys(data.dataQuality.counts)).toEqual(["live"]);
  });

  it("tallies mixed freshness values correctly, matching each factor's own real freshness", async () => {
    const base = fixtureScore({});
    const score: MarketScore = {
      ...base,
      factors: base.factors.map((f, i) => (i === 0 ? { ...f, freshness: "delayed" } : i === 1 ? { ...f, freshness: "not_applicable" } : f)),
    };
    const data = await buildScorecardData(GOLD, score, fixtureLiveDetail());
    expect(data.dataQuality.total).toBe(9);
    expect(data.dataQuality.counts.delayed).toBe(1);
    expect(data.dataQuality.counts.not_applicable).toBe(1);
    expect(data.dataQuality.counts.live).toBe(7);
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

  it("includes a Fed Funds Rate release row when one is stored for the country in scope, with a deterministic hawkish/dovish Bias (in-line print reads Neutral)", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:fedRateDecision": { event: "Fed Funds Rate", dateTime: "2027-01-29T19:00:00.000Z", actual: 4.5, previous: 4.75, forecast: 4.5, importanceTier: "HIGH" } })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.interestRates.kind).toBe("gold-drivers");
    if (data.interestRates.kind !== "gold-drivers") throw new Error("unreachable");
    expect(data.interestRates.releases).toHaveLength(1);
    expect(data.interestRates.releases[0]).toMatchObject({ label: "Fed Funds Rate", actual: 4.5, previous: 4.75, forecast: 4.5, classification: "Neutral" });
  });

  it("gives gold a Bearish Bias on a hawkish Fed surprise (actual above forecast) and Bullish on a dovish one", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "US:fedRateDecision": { event: "Fed Funds Rate", dateTime: "2027-01-29T19:00:00.000Z", actual: 4.75, previous: 4.5, forecast: 4.5, importanceTier: "HIGH" } })
    );
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    if (data.interestRates.kind !== "gold-drivers") throw new Error("unreachable");
    expect(data.interestRates.releases[0].classification).toBe("Bearish");
  });

  it("gives an FX pair a Bullish Bias when its BASE currency surprises hawkish, and Bearish when its QUOTE currency does", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "GB:boeRateDecision": { event: "BoE Rate Decision", dateTime: "2027-01-30T12:00:00.000Z", actual: 4.25, previous: 4.0, forecast: 4.0, importanceTier: "HIGH" },
        "US:fedRateDecision": { event: "Fed Funds Rate", dateTime: "2027-01-29T19:00:00.000Z", actual: 4.75, previous: 4.5, forecast: 4.5, importanceTier: "HIGH" },
      })
    );
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    if (data.interestRates.kind !== "generic") throw new Error("unreachable");
    const boe = data.interestRates.releases.find((r) => r.label === "BoE Rate Decision");
    const fed = data.interestRates.releases.find((r) => r.label === "Fed Funds Rate");
    expect(boe?.classification).toBe("Bullish"); // hawkish base (GBP) -> pair up
    expect(fed?.classification).toBe("Bearish"); // hawkish quote (USD) -> pair down
  });

  it("includes both base and quote central-bank rate-decision releases for an FX pair", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "GB:boeRateDecision": { event: "BoE Rate Decision", dateTime: "2027-01-30T12:00:00.000Z", actual: 4.0, previous: 4.25, forecast: 4.0, importanceTier: "HIGH" },
        "US:fedRateDecision": { event: "Fed Funds Rate", dateTime: "2027-01-29T19:00:00.000Z", actual: 4.5, previous: 4.75, forecast: 4.5, importanceTier: "HIGH" },
      })
    );
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    if (data.interestRates.kind !== "generic") throw new Error("unreachable");
    expect(data.interestRates.releases.map((r) => r.label).sort()).toEqual(["BoE Rate Decision", "Fed Funds Rate"]);
  });

  it("omits release rows entirely (never an empty table) when no rate-decision release is stored", async () => {
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    if (data.interestRates.kind !== "generic") throw new Error("unreachable");
    expect(data.interestRates.releases).toEqual([]);
  });

  it("includes a 10Y yield alongside the existing 2Y yield for the generic (non-gold) section", async () => {
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (_country, indicator) => ({
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: indicator === "yield10y" ? [{ date: "2027-01-01", value: 4.2 }] : null,
    }));
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    if (data.interestRates.kind !== "generic") throw new Error("unreachable");
    expect(data.interestRates.yield10y.data).toEqual({ rate: 4.2, date: "2027-01-01" });
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

describe("buildScorecardData — Currency Comparison (pre-launch Scorecard rename)", () => {
  it("is null for a non-FX instrument — nothing forced onto an asset it doesn't apply to", async () => {
    vi.mocked(buildForexScorecard).mockClear();
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.currencyComparison).toBeNull();
    expect(buildForexScorecard).not.toHaveBeenCalled();
  });

  it("passes through forex-scorecard.ts's already-composed data verbatim for an FX pair — no recomputation", async () => {
    const stub = {
      symbol: "GBPUSD",
      base: "GBP",
      quote: "USD",
      baseStrength: { currency: "GBP", country: "GB", score: 61, level: "Strong" as const, drivers: [], freshness: "live" as const },
      quoteStrength: { currency: "USD", country: "US", score: -34, level: "Weak" as const, drivers: [], freshness: "live" as const },
      strengthDifferential: 95,
      baseRate: 3.75,
      quoteRate: 0.84,
      rateDifferentialPts: 2.91,
      surpriseDifferential: 36,
      baseSurprise: 24,
      quoteSurprise: -12,
      baseGrowthContribution: 4.2,
      quoteGrowthContribution: -1.8,
      growthDifferential: 6,
      baseLaborContribution: 2.1,
      quoteLaborContribution: -0.5,
      laborDifferential: 2.6,
      dailyTrend: "Bullish" as const,
      h4Trend: "Bullish" as const,
      h1Trend: "Neutral" as const,
      technicalFreshness: "live" as const,
      retail: { pctLong: 32, pctShort: 68, contrarianBias: "Bullish" as const },
      finalScore: 4.8,
      finalBias: "Very Bullish" as const,
      strengthBand: "Strong bullish" as const,
      rateBand: "Strong bullish" as const,
      surpriseBand: "Strong bullish" as const,
      growthBand: "Strong bullish" as const,
      laborBand: "Strong bullish" as const,
      narrative: "GBP currently has stronger macro conditions.",
    };
    vi.mocked(buildForexScorecard).mockResolvedValue(stub);
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    expect(data.currencyComparison).toEqual(stub);
    expect(buildForexScorecard).toHaveBeenCalledWith("GBPUSD", false);
  });
});

describe("buildScorecardData — dual base/quote Economy sections (FX is a relative trade)", () => {
  it("is null for every non-FX instrument — Growth/Inflation/Jobs stay single-column exactly as before", async () => {
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.economicGrowthQuote).toBeNull();
    expect(data.inflationQuote).toBeNull();
    expect(data.jobsMarketQuote).toBeNull();
    expect(data.baseCurrency).toBeNull();
    expect(data.quoteCurrency).toBeNull();
  });

  it("populates the quote economy's Growth/Inflation/Jobs sections for an FX pair from real stored GB releases", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "US:gdp": { event: "GDP QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.1, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" },
        "GB:gdp": { event: "GDP QoQ", dateTime: "2027-01-28T00:00:00.000Z", actual: 0.5, previous: 0.3, forecast: 0.4, importanceTier: "HIGH" },
      })
    );
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    expect(data.baseCurrency).toBe("GBP");
    expect(data.quoteCurrency).toBe("USD");
    expect(calendarRow(data.economicGrowth, "gdp")!.actual).toBe(0.5); // base = GBP
    expect(calendarRow(data.economicGrowthQuote!, "gdp")!.actual).toBe(2.1); // quote = USD
  });

  it("reads the quote economy from the SAME single batched events query — zero additional calendar queries for showing both sides", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockClear();
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({ "GB:gdp": { event: "GDP QoQ", dateTime: "2027-01-28T00:00:00.000Z", actual: 0.5, previous: 0.3, forecast: 0.4, importanceTier: "HIGH" } })
    );
    await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    expect(getLatestEconomicEventsByIndicators).toHaveBeenCalledTimes(1);
  });

  it("never fetches the same (country, FRED series) pair twice in one render — the shared FredReadCache dedupes it", async () => {
    const fredCalls: string[] = [];
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (country, indicator) => {
      fredCalls.push(`${country}:${indicator}`);
      return {
        provider: "fred", source: "FRED", status: "live", fetchedAt: new Date().toISOString(), sourceUpdatedAt: "2026-07-01", nextExpectedUpdate: null,
        value: [{ date: "2026-05-01", value: 100 }, { date: "2026-06-01", value: 101 }, { date: "2026-07-01", value: 103 }],
      };
    });
    await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    const counts = new Map<string, number>();
    for (const c of fredCalls) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const [pair, n] of counts) expect(n, `${pair} was fetched ${n} times, expected at most 1`).toBe(1);
  });

  it("flips Bias into a pair-relative read for the quote economy: a GBP growth beat stays Bullish (base), a USD growth beat becomes Bearish for GBPUSD (quote)", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "GB:gdp": { event: "GDP QoQ", dateTime: "2027-01-28T00:00:00.000Z", actual: 0.6, previous: 0.3, forecast: 0.4, importanceTier: "HIGH" }, // GBP beat
        "US:gdp": { event: "GDP QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.5, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" }, // USD beat
      })
    );
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    const gbpRow = calendarRow(data.economicGrowth, "gdp")!;
    const usdRow = calendarRow(data.economicGrowthQuote!, "gdp")!;
    // Raw domestic direction: both are genuine beats, so both classify Bullish for their own economy.
    expect(gbpRow.classification).toBe("Bullish");
    expect(usdRow.classification).toBe("Bullish");
    // Pair-relative Bias: base beat supports the pair; quote beat pressures it.
    expect(gbpRow.pairBias).toBe("Bullish");
    expect(usdRow.pairBias).toBe("Bearish");
  });

  it("flips a quote-side FRED macro-state Bias too, not just calendar releases", async () => {
    vi.mocked(getFredSeriesWithFallback).mockImplementation(async (country) => ({
      provider: "fred", source: "FRED", status: "live", fetchedAt: new Date().toISOString(), sourceUpdatedAt: "2026-07-01", nextExpectedUpdate: null,
      value: country === "US" ? [{ date: "2026-05-01", value: 100 }, { date: "2026-06-01", value: 101 }, { date: "2026-07-01", value: 103 }] : null,
    }));
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    const usdGdpRow = macroStateRow(data.economicGrowthQuote!, "GDP Growth QoQ")!;
    expect(usdGdpRow).toBeDefined();
    expect(usdGdpRow.classification).toBe("Bullish"); // rising GDP is domestically Bullish for USD
    expect(usdGdpRow.pairBias).toBe("Bearish"); // but bearish for GBPUSD since USD is the quote currency
  });

  it("Neutral and unclassifiable rows are never flipped into a fabricated direction", async () => {
    vi.mocked(getLatestEconomicEventsByIndicators).mockResolvedValue(
      eventsMap({
        "US:gdp": { event: "GDP QoQ", dateTime: "2027-01-30T00:00:00.000Z", actual: 2.0, previous: 1.9, forecast: 2.0, importanceTier: "HIGH" }, // exact in-line -> Neutral
        "US:pce": { event: "PCE YoY", dateTime: "2027-01-31T00:00:00.000Z", actual: 2.8, previous: 2.9, forecast: null, importanceTier: "HIGH" }, // no forecast -> null
      })
    );
    const data = await buildScorecardData(GBPUSD, fixtureScore({}), fixtureLiveDetail());
    expect(calendarRow(data.economicGrowthQuote!, "gdp")!.pairBias).toBe("Neutral");
    expect(calendarRow(data.inflationQuote!, "pce")!.pairBias).toBeNull();
  });
});

describe("cotChangeLabel", () => {
  it("reads a growing net-long position as Increasing longs", () => {
    expect(cotChangeLabel({ direction: "Bullish", netWeeklyChange: 500 })).toBe("Increasing longs");
  });
  it("reads a shrinking net-long position as Reducing longs", () => {
    expect(cotChangeLabel({ direction: "Bullish", netWeeklyChange: -500 })).toBe("Reducing longs");
  });
  it("reads a deepening net-short position as Increasing shorts", () => {
    expect(cotChangeLabel({ direction: "Bearish", netWeeklyChange: -500 })).toBe("Increasing shorts");
  });
  it("reads a shrinking net-short position as Reducing shorts", () => {
    expect(cotChangeLabel({ direction: "Bearish", netWeeklyChange: 500 })).toBe("Reducing shorts");
  });
  it("reads a near-zero weekly change as Little change regardless of direction", () => {
    expect(cotChangeLabel({ direction: "Bullish", netWeeklyChange: 0.4 })).toBe("Little change");
  });
});

describe("buildScorecardData — News & Market Context", () => {
  function fixtureNews(overrides: Partial<import("@/db/queries/market-data").StoredNewsArticle> = {}): import("@/db/queries/market-data").StoredNewsArticle {
    return {
      id: 1,
      headline: "Test headline",
      source: "Test wire",
      url: null,
      publishedAt: new Date().toISOString(),
      affectedMarkets: ["XAUUSD"],
      interpretation: "Neutral",
      importance: 50,
      confidence: 70,
      reason: "test",
      ...overrides,
    };
  }

  it("only surfaces items tagged to this instrument's affected markets", async () => {
    vi.mocked(getRecentNews).mockResolvedValue([
      fixtureNews({ id: 1, headline: "Relevant", affectedMarkets: ["XAUUSD"] }),
      fixtureNews({ id: 2, headline: "Irrelevant", affectedMarkets: ["BTCUSD"] }),
    ]);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.newsContext.latest.map((n) => n.id)).toEqual(["1"]);
  });

  it("only surfaces monetary-policy/geopolitical context above the relevance threshold — never a low-relevance item", async () => {
    vi.mocked(getRecentNews).mockResolvedValue([
      fixtureNews({ id: 3, headline: "Low relevance", monetaryPolicyRelevance: 10, geopoliticalRelevance: 10 }),
    ]);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.newsContext.monetaryPolicy).toBeNull();
    expect(data.newsContext.geopolitical).toBeNull();
  });

  it("surfaces the highest-relevance monetary-policy item once it clears the threshold", async () => {
    vi.mocked(getRecentNews).mockResolvedValue([
      fixtureNews({ id: 4, headline: "Fed signals hold", monetaryPolicyRelevance: 90 }),
    ]);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.newsContext.monetaryPolicy?.id).toBe("4");
  });

  it("filters upcoming events to this instrument's affected markets", async () => {
    vi.mocked(getUpcomingHighImpactEvents).mockResolvedValue([
      { id: 1, country: "US", event: "CPI", dateTime: new Date().toISOString(), impact: "High", actual: null, previous: null, forecast: null, affectedMarkets: ["XAUUSD"], processingStatus: null },
      { id: 2, country: "JP", event: "BoJ Rate Decision", dateTime: new Date().toISOString(), impact: "High", actual: null, previous: null, forecast: null, affectedMarkets: ["USDJPY"], processingStatus: null },
    ]);
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.newsContext.upcomingEvent?.event).toBe("CPI");
  });

  it("never fabricates content — empty feeds produce an empty (not invented) context", async () => {
    const data = await buildScorecardData(GOLD, fixtureScore({}), fixtureLiveDetail());
    expect(data.newsContext.latest).toEqual([]);
    expect(data.newsContext.monetaryPolicy).toBeNull();
    expect(data.newsContext.geopolitical).toBeNull();
    expect(data.newsContext.riskSentiment).toBeNull();
    expect(data.newsContext.upcomingEvent).toBeNull();
  });
});
