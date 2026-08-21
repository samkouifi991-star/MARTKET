// GBPUSD end-to-end reference test — the "first complete live reference
// market" validation. Mocks the four provider clients at the module
// boundary with realistic, hand-built response shapes (never randomized —
// these are fixed fixtures so the test is reproducible), then runs the
// exact production code path (computeLiveMarketScore) to prove the whole
// External API -> normalization -> factor engine -> weighted score ->
// market score pipeline assembles correctly for a real currency pair.
//
// This proves the CODE is correct against realistic payload shapes. It does
// not prove FMP/CFTC/FRED/IG's actual live responses match these shapes —
// that verification only happens once real credentials are live (see the
// VERIFY notes in services/market-data/cftc.ts and fred-series.ts).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTrendingCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/fmp");
vi.mock("@/services/market-data/cftc");
vi.mock("@/services/market-data/fred");
vi.mock("@/services/market-data/ig");
vi.mock("@/db/queries/market-data");
vi.mock("@/db/queries/scores");

import * as fmp from "@/services/market-data/fmp";
import * as cftc from "@/services/market-data/cftc";
import * as fred from "@/services/market-data/fred";
import * as ig from "@/services/market-data/ig";
import { getLatestStoredPrice, getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { computeLiveMarketScore } from "./scoring-engine";

const dailyCandles: NormalizedCandle[] = buildTrendingCandles({ bars: 260, startPrice: 1.24, trendPerBar: 0.0012, noise: 0.0008, seed: 55 });

function mockFmpLive() {
  vi.mocked(fmp.getQuote).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: { symbol: "GBPUSD", price: dailyCandles[dailyCandles.length - 1].close, changePct24h: 0.3, timestamp: new Date().toISOString() },
  });
  vi.mocked(fmp.getDailyCandles).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: dailyCandles[dailyCandles.length - 1].date,
    nextExpectedUpdate: null,
    value: dailyCandles,
  });
  vi.mocked(fmp.getIntradayCandles).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: buildTrendingCandles({ bars: 200, startPrice: 1.24, trendPerBar: 0.0003, noise: 0.0005, seed: 56 }),
  });
  vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: [
      { id: "n1", headline: "GBP rallies as UK services PMI beats expectations", source: "Wire Service", publishedAt: new Date().toISOString(), url: "https://example.com/1", symbols: ["GBPUSD"] },
      { id: "n2", headline: "Bank of England signals hawkish pause, GBP strengthens", source: "Wire Service", publishedAt: new Date().toISOString(), url: "https://example.com/2", symbols: ["GBPUSD"] },
    ],
  });
}

function mockCftcLive() {
  const netHistory = [46000, 39000, 31000, 24000, 16000, 9000, 2000].map((net, i) => ({
    reportDate: new Date(Date.now() - i * 7 * 86_400_000).toISOString(),
    netPositioning: net,
  }));
  vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue({
    provider: "cftc",
    source: "CFTC Traders in Financial Futures",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: netHistory[0].reportDate,
    nextExpectedUpdate: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    value: {
      classification: "Asset Manager",
      reportDate: netHistory[0].reportDate,
      longContracts: 60000,
      shortContracts: 14000,
      netPositioning: netHistory[0].netPositioning,
      pctLong: 81,
      pctShort: 19,
      openInterest: 210000,
      netWeeklyChange: netHistory[0].netPositioning - netHistory[1].netPositioning,
      percentile1y: 78,
      percentile3y: 74,
      direction: "Bullish",
      strength: "Strong",
      netHistory,
      marketAndExchangeName: "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE",
      cftcContractMarketCode: "096742",
    },
  });
}

function mockFredLive() {
  vi.mocked(fred.getSeries).mockImplementation(async (country, indicator) => {
    // Simulates GB macro data improving faster than US — should push the
    // FX differential (and therefore GBPUSD) bullish, matching the spec's
    // own worked example for this exact pair.
    const gbSeries: Record<string, number[]> = {
      cpi: [2.0, 2.1, 2.3, 2.6],
      coreCpi: [2.2, 2.3, 2.4, 2.6],
      unemploymentRate: [4.3, 4.2, 4.1, 3.9],
      payrolls: [100, 102, 105, 110],
      realGdp: [100, 100.6, 101.4, 102.5],
      gdpGrowth: [0.3, 0.4, 0.5, 0.7],
      policyRate: [5.0, 5.0, 5.0, 5.25],
    };
    const usSeries: Record<string, number[]> = {
      cpi: [3.0, 3.0, 3.0, 3.0],
      coreCpi: [3.2, 3.2, 3.2, 3.2],
      unemploymentRate: [3.9, 4.0, 4.0, 4.1],
      payrolls: [1000, 1005, 1008, 1010],
      realGdp: [100, 100.2, 100.3, 100.4],
      gdpGrowth: [0.2, 0.2, 0.1, 0.1],
      policyRate: [5.25, 5.25, 5.25, 5.25],
    };
    const table = country === "GB" ? gbSeries : country === "US" ? usSeries : null;
    const values = table?.[indicator];
    if (!values) {
      return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    }
    return {
      provider: "fred",
      source: "FRED",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: values.map((value, i) => ({ date: `2025-0${i + 1}-01`, value })),
    };
  });
}

function mockIgUnavailable() {
  vi.mocked(ig.getRetailSentiment).mockResolvedValue({
    provider: "ig",
    source: "IG Client Sentiment",
    status: "unavailable",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: null,
    nextExpectedUpdate: null,
    value: null,
    error: "No confirmed IG epic for GBPUSD",
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  // Default: no last-known-good data stored — tests that want to exercise
  // the fallback set these explicitly. Without this, a live-call failure
  // would try to hit a real (unconfigured-in-tests) database instead of
  // taking the "never had data -> unavailable" path.
  vi.mocked(getLatestStoredPrice).mockResolvedValue(null);
  vi.mocked(getLatestStoredDailyCandles).mockResolvedValue(null);
  // computeLiveMarketScore always calls recordScoreHistory(score).catch(...)
  // — an auto-mocked fn returns undefined, and undefined has no .catch(),
  // so this needs an explicit resolved-promise mock or every test throws.
  const scores = await import("@/db/queries/scores");
  vi.mocked(scores.recordScoreHistory).mockResolvedValue(undefined);
  vi.mocked(scores.getScoreHistory).mockResolvedValue([]);
});

describe("GBPUSD end-to-end live pipeline", () => {
  it("computes a reproducible total score from real-shaped provider fixtures, all factors live", async () => {
    mockFmpLive();
    mockCftcLive();
    mockFredLive();
    mockIgUnavailable(); // honest: GBPUSD has no confirmed IG epic yet

    const score = await computeLiveMarketScore("GBPUSD", "live");

    // Reproducibility: total must equal the sum of the displayed factor contributions.
    const recomputedTotal = Number(score.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
    expect(score.totalScore).toBe(recomputedTotal);

    // Every factor key from the spec must be present exactly once.
    const keys = score.factors.map((f) => f.key).sort();
    expect(keys).toEqual(["economicGrowth", "inflation", "institutional", "interestRates", "labor", "news", "retailSentiment", "seasonality", "technical"].sort());

    // Retail sentiment must be honestly unavailable — never estimated — since
    // GBPUSD has no confirmed IG epic.
    const retail = score.factors.find((f) => f.key === "retailSentiment")!;
    expect(retail.freshness).toBe("unavailable");
    expect(retail.contribution).toBe(0);
    expect(retail.explanation.toLowerCase()).toContain("unavailable");

    // Institutional positioning came from CFTC and should be live + bullish
    // (heavy asset-manager long skew in the fixture).
    const institutional = score.factors.find((f) => f.key === "institutional")!;
    expect(institutional.freshness).toBe("live");
    expect(institutional.contribution).toBeGreaterThan(0);

    // Technical trend came from real FMP-shaped candles in a sustained uptrend.
    const technical = score.factors.find((f) => f.key === "technical")!;
    expect(technical.freshness).toBe("live");
    expect(technical.contribution).toBeGreaterThan(0);

    // GB macro improving faster than US macro (per the fixture) should tilt
    // growth/labor bullish for GBP — the spec's own worked example.
    const growth = score.factors.find((f) => f.key === "economicGrowth")!;
    expect(growth.freshness).toBe("live");
    expect(growth.rawScore).toBeGreaterThan(0);

    // Confidence should be high with 8/9 factors live and only one honestly unavailable.
    expect(score.confidence).toBeGreaterThan(50);
  });

  it("builds score.history from real stored market_scores rows, not a hardcoded single point", async () => {
    // The actual bug: history was always [{date: now, score: totalScore}]
    // regardless of how many rows market_scores actually had — the DB read
    // simply never happened.
    mockFmpLive();
    mockCftcLive();
    mockFredLive();
    mockIgUnavailable();
    const scores = await import("@/db/queries/scores");
    const oldPoint = { computedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(), totalScore: 0.5, bias: "Neutral", confidence: 40 };
    const recentPoint = { computedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), totalScore: 1.0, bias: "Neutral", confidence: 55 };
    // getScoreHistory's real query orders newest-first (desc) — the mock
    // must match that ordering for the source's own .reverse() to be tested
    // correctly, not just happen to pass on already-sorted input.
    vi.mocked(scores.getScoreHistory).mockResolvedValue([recentPoint, oldPoint]);

    const score = await computeLiveMarketScore("GBPUSD", "live");

    // Real stored points, re-ordered oldest-first, plus the just-computed
    // current point appended last.
    expect(score.history).toHaveLength(3);
    expect(score.history[0].date).toBe(oldPoint.computedAt);
    expect(score.history[1].date).toBe(recentPoint.computedAt);
    expect(score.history[2].score).toBe(score.totalScore);

    // change24h computed from the closest real point at least ~24h old,
    // not hardcoded to 0.
    expect(score.change24h).toBe(Number((score.totalScore - oldPoint.totalScore).toFixed(2)));
  });

  it("does NOT write a market_scores row by default — only an explicit persist:true does", async () => {
    // The real bug this locks in: computeLiveMarketScore used to call
    // recordScoreHistory unconditionally, and the market detail page used
    // to be statically prerendered once per deploy — so every test
    // deployment silently wrote its own "observation," polluting the score
    // history chart with build artifacts instead of genuine periodic market
    // snapshots. Only the scores cron (which passes persist:true) should
    // ever write history now; a plain page-render computation must not.
    mockFmpLive();
    mockCftcLive();
    mockFredLive();
    mockIgUnavailable();
    const scores = await import("@/db/queries/scores");

    await computeLiveMarketScore("GBPUSD", "live");
    expect(scores.recordScoreHistory).not.toHaveBeenCalled();

    await computeLiveMarketScore("GBPUSD", "live", { persist: true });
    expect(scores.recordScoreHistory).toHaveBeenCalledTimes(1);
  });

  it("never fabricates a value when every live provider fails — factors go unavailable and confidence drops", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "simulated outage" };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    mockIgUnavailable();

    const score = await computeLiveMarketScore("GBPUSD", "live");

    expect(score.totalScore).toBe(0);
    expect(score.factors.every((f) => f.freshness === "unavailable" || f.freshness === "error")).toBe(true);
    expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
    expect(score.confidence).toBeLessThan(30);
  });

  it("in hybrid mode, ordinary markets fall back to clearly-labeled demo data per factor instead of showing unavailable", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    mockIgUnavailable();

    // NZDUSD, not GBPUSD/EURUSD/USDCAD/etc: all of those are strict-live
    // symbols with stricter no-fallback rules (see the next tests), so
    // this proves an ordinary, not-yet-promoted market keeps the normal
    // hybrid leniency.
    const score = await computeLiveMarketScore("NZDUSD", "hybrid");

    const nonRetailFactors = score.factors.filter((f) => f.key !== "retailSentiment");
    expect(nonRetailFactors.every((f) => f.freshness === "estimated")).toBe(true);
    // Retail sentiment has no demo-fallback path here because IG explicitly
    // has no epic for this market — hybrid must not invent a percentage either.
    const retail = score.factors.find((f) => f.key === "retailSentiment")!;
    expect(retail.freshness).toBe("unavailable");
  });

  it("in hybrid mode, GBPUSD (the strict-live reference market) never falls back to demo data — it shows unavailable and confidence drops", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    mockIgUnavailable();

    const score = await computeLiveMarketScore("GBPUSD", "hybrid");

    // No factor may be silently backed by demo data for GBPUSD, even in
    // hybrid mode — every factor must honestly read unavailable/error.
    expect(score.factors.every((f) => f.freshness === "unavailable" || f.freshness === "error")).toBe(true);
    expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
    expect(score.confidence).toBeLessThan(30);
  });

  it("in hybrid mode, the second-phase batch (EURUSD, USDJPY, XAUUSD, BTCUSD, SPX500) also never falls back to demo data — same strict-live bar as GBPUSD", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    mockIgUnavailable();

    for (const symbol of ["EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500"]) {
      const score = await computeLiveMarketScore(symbol, "hybrid");
      const applicable = score.factors.filter((f) => f.freshness !== "not_applicable");
      expect(applicable.every((f) => f.freshness === "unavailable" || f.freshness === "error")).toBe(true);
      expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
    }
  });

  it("in hybrid mode, the third-phase batch (AUDUSD, USDCAD, XAGUSD, DJ30) also never falls back to demo data — same strict-live bar as GBPUSD", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(fmp.getForexAndMarketNews).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    mockIgUnavailable();

    for (const symbol of ["AUDUSD", "USDCAD", "XAGUSD", "DJ30"]) {
      const score = await computeLiveMarketScore(symbol, "hybrid");
      const applicable = score.factors.filter((f) => f.freshness !== "not_applicable");
      expect(applicable.every((f) => f.freshness === "unavailable" || f.freshness === "error")).toBe(true);
      expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
    }
  });
});
