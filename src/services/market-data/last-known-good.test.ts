import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./market-data-router");
vi.mock("./cftc");
vi.mock("./fred");
vi.mock("@/db/queries/market-data");

import * as marketData from "./market-data-router";
import * as cftc from "./cftc";
import * as fred from "./fred";
import {
  getLatestStoredPrice,
  getLatestStoredDailyCandles,
  getLatestStoredPositioning,
  getLatestStoredRetailSentiment,
  getLatestStoredEconomicSeries,
} from "@/db/queries/market-data";
import {
  getQuoteWithFallback,
  getDailyCandlesWithFallback,
  getPositioningWithFallback,
  getFredSeriesWithFallback,
  getRetailSentimentFromStorage,
} from "./last-known-good";
import { CftcPositioningResult } from "./cftc";

const down = { provider: "fmp" as const, source: "n/a", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "RATE_LIMITED" };

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

beforeEach(() => vi.resetAllMocks());

describe("getQuoteWithFallback", () => {
  it("passes through the live result unchanged when the live call succeeds", async () => {
    const live = { provider: "fmp" as const, source: "FMP", status: "live" as const, fetchedAt: "now", sourceUpdatedAt: "now", nextExpectedUpdate: null, value: { symbol: "GBPUSD", price: 1.3, changePct24h: 0.1, timestamp: "now" } };
    vi.mocked(marketData.getQuote).mockResolvedValue(live);

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result).toBe(live);
    expect(getLatestStoredPrice).not.toHaveBeenCalled();
  });

  it("falls back to a recently-stored price as DELAYED when the live call fails", async () => {
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue({ price: 1.36388, changePct24h: 0.2, provider: "fmp", sourceUpdatedAt: hoursAgo(2), fetchedAt: hoursAgo(2) });

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result.status).toBe("delayed");
    expect(result.value?.price).toBe(1.36388);
    expect(result.fetchedAt).not.toBe(new Date().toISOString().slice(0, 10)); // not "now" — the real stored timestamp
    expect(new Date(result.fetchedAt).getTime()).toBeLessThan(Date.now() - 3_600_000);
  });

  it("classifies an old stored price as STALE, not DELAYED", async () => {
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue({ price: 1.36388, changePct24h: 0.2, provider: "fmp", sourceUpdatedAt: hoursAgo(200), fetchedAt: hoursAgo(200) });

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result.status).toBe("stale");
    expect(result.value?.price).toBe(1.36388); // real value still returned, not erased
  });

  it("reports UNAVAILABLE (the live result, unchanged) only when there has never been a stored value", async () => {
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue(null);

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result).toBe(down);
    expect(result.status).toBe("unavailable");
  });
});

describe("getDailyCandlesWithFallback", () => {
  it("falls back to stored candles as DELAYED when the live call fails, preserving the real candle count", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    const candles = Array.from({ length: 228 }, (_, i) => ({ date: new Date(Date.now() - i * 86_400_000).toISOString(), open: 1, high: 1.01, low: 0.99, close: 1.005, volume: null }));
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles, fetchedAt: hoursAgo(3), provider: "fmp" });

    const result = await getDailyCandlesWithFallback("GBPUSD");

    expect(result.status).toBe("delayed");
    expect(result.value).toHaveLength(228);
  });

  it("never claims a stored value came from 'now' — fetchedAt reflects the real storage time", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    const storedAt = hoursAgo(50); // beyond the 36h "delayed" window
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({
      candles: [{ date: hoursAgo(50).toISOString(), open: 1, high: 1.01, low: 0.99, close: 1.005, volume: null }],
      fetchedAt: storedAt,
      provider: "fmp",
    });

    const result = await getDailyCandlesWithFallback("GBPUSD");

    expect(result.status).toBe("stale");
    expect(result.fetchedAt).toBe(storedAt.toISOString());
  });
});

function fixturePositioning(overrides: Partial<CftcPositioningResult> = {}): CftcPositioningResult {
  return {
    classification: "Asset Manager",
    reportDate: hoursAgo(240).toISOString(), // 10 days — within the live path's own "live" window
    longContracts: 60000,
    shortContracts: 14000,
    netPositioning: 46000,
    pctLong: 81,
    pctShort: 19,
    openInterest: 210000,
    netWeeklyChange: 2000,
    percentile1y: 78,
    percentile3y: 74,
    direction: "Bullish",
    strength: "Strong",
    netHistory: [{ reportDate: hoursAgo(240).toISOString(), netPositioning: 46000 }],
    marketAndExchangeName: "GBP - CME",
    cftcContractMarketCode: "099741",
    ...overrides,
  };
}

describe("getPositioningWithFallback", () => {
  it("passes through a live 'stale' result unchanged — already the freshest obtainable data, not a reason to check storage", async () => {
    const live = { provider: "cftc" as const, source: "CFTC Traders in Financial Futures", status: "stale" as const, fetchedAt: "now", sourceUpdatedAt: "now", nextExpectedUpdate: "next-friday", value: fixturePositioning() };
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(live);

    const result = await getPositioningWithFallback("GBPUSD");

    expect(result).toBe(live);
    expect(getLatestStoredPositioning).not.toHaveBeenCalled();
  });

  it("falls back to a recently-stored report as DELAYED when the live call genuinely fails", async () => {
    const down = { provider: "cftc" as const, source: "CFTC Traders in Financial Futures", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "request failed" };
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(cftc.isCftcReportWithinFreshnessLimit).mockReturnValue(true);
    vi.mocked(getLatestStoredPositioning).mockResolvedValue({ positioning: fixturePositioning(), fetchedAt: hoursAgo(2) });

    const result = await getPositioningWithFallback("GBPUSD");

    expect(result.status).toBe("delayed");
    expect(result.value?.netPositioning).toBe(46000);
  });

  it("classifies an older stored report as STALE, not DELAYED, while still using the real data", async () => {
    const down = { provider: "cftc" as const, source: "CFTC Traders in Financial Futures", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "request failed" };
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(cftc.isCftcReportWithinFreshnessLimit).mockReturnValue(true);
    vi.mocked(getLatestStoredPositioning).mockResolvedValue({ positioning: fixturePositioning(), fetchedAt: hoursAgo(200) });

    const result = await getPositioningWithFallback("GBPUSD");

    expect(result.status).toBe("stale");
  });

  it("never uses a stored report beyond the existing CFTC freshness limit, even if it's the newest thing stored", async () => {
    const down = { provider: "cftc" as const, source: "CFTC Traders in Financial Futures", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "request failed" };
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(cftc.isCftcReportWithinFreshnessLimit).mockReturnValue(false); // report itself too old, per CFTC's own ceiling
    vi.mocked(getLatestStoredPositioning).mockResolvedValue({ positioning: fixturePositioning(), fetchedAt: hoursAgo(1) });

    const result = await getPositioningWithFallback("GBPUSD");

    expect(result).toBe(down); // the live unavailable result, unchanged — not the too-old stored report
  });

  it("reports the live result unchanged when there has never been a stored report", async () => {
    const down = { provider: "cftc" as const, source: "CFTC Traders in Financial Futures", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "no CFTC coverage" };
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(getLatestStoredPositioning).mockResolvedValue(null);

    const result = await getPositioningWithFallback("EURGBP");

    expect(result).toBe(down);
  });
});

describe("getFredSeriesWithFallback", () => {
  it("passes through a live 'stale' result unchanged — a real observation is already the freshest obtainable", async () => {
    const live = { provider: "fred" as const, source: "FRED (Federal Reserve Economic Data)", status: "stale" as const, fetchedAt: "now", sourceUpdatedAt: "2024-01-01", nextExpectedUpdate: null, value: [{ date: "2024-01-01", value: 3.1 }] };
    vi.mocked(fred.getSeries).mockResolvedValue(live);

    const result = await getFredSeriesWithFallback("GB", "cpi");

    expect(result).toBe(live);
    expect(getLatestStoredEconomicSeries).not.toHaveBeenCalled();
  });

  it("falls back to stored observations and classifies freshness from the observation's own age, like the live path does", async () => {
    const down = { provider: "fred" as const, source: "FRED (Federal Reserve Economic Data)", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "FRED_API_KEY is not configured" };
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    vi.mocked(fred.classifyFredFreshness).mockReturnValue({ freshness: "delayed", ageDays: 40, cadence: "monthly" });
    vi.mocked(getLatestStoredEconomicSeries).mockResolvedValue({ points: [{ date: "2026-06-01", value: 2.7 }], fetchedAt: hoursAgo(2) });

    const result = await getFredSeriesWithFallback("US", "cpi");

    expect(result.status).toBe("delayed");
    expect(result.value?.[0].value).toBe(2.7);
    expect(result.sourceUpdatedAt).toBe("2026-06-01"); // the real observation date, not "now"
  });

  it("reports the live result unchanged when there has never been a stored observation", async () => {
    const down = { provider: "fred" as const, source: "FRED (Federal Reserve Economic Data)", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "No FRED series mapped for JP/realGdp" };
    vi.mocked(fred.getSeries).mockResolvedValue(down);
    vi.mocked(getLatestStoredEconomicSeries).mockResolvedValue(null);

    const result = await getFredSeriesWithFallback("JP", "realGdp");

    expect(result).toBe(down);
  });
});

describe("getRetailSentimentFromStorage — reads Neon only, freshness driven by the source timestamp's age, not how recently the row was read", () => {
  it("classifies a fresh OANDA source timestamp as LIVE even though it was read from Neon — storage provenance never forces a downgrade", async () => {
    // fetchedAt is old (the row itself was written a while ago) but
    // sourceUpdatedAt (OANDA's own timestamp) is fresh — freshness must
    // follow sourceUpdatedAt, not fetchedAt.
    vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue({ pctLong: 58, pctShort: 42, provider: "oanda", source: "OANDA PositionBook", fetchedAt: hoursAgo(10), sourceUpdatedAt: hoursAgo(1) });

    const result = await getRetailSentimentFromStorage("EURUSD");

    expect(result.status).toBe("live");
    expect(result.provider).toBe("oanda");
    expect(result.source).toBe("OANDA PositionBook");
    expect(result.value?.pctLong).toBe(58);
  });

  it("classifies an aging source timestamp as DELAYED even when the row was just written — fetchedAt recency alone doesn't make it live", async () => {
    vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue({ pctLong: 58, pctShort: 42, provider: "oanda", source: "OANDA PositionBook", fetchedAt: hoursAgo(0), sourceUpdatedAt: hoursAgo(10) });

    const result = await getRetailSentimentFromStorage("EURUSD");

    expect(result.status).toBe("delayed");
  });

  it("classifies an old source timestamp as STALE, not DELAYED", async () => {
    vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue({ pctLong: 58, pctShort: 42, provider: "oanda", source: "OANDA PositionBook", fetchedAt: hoursAgo(0), sourceUpdatedAt: hoursAgo(200) });

    const result = await getRetailSentimentFromStorage("EURUSD");

    expect(result.status).toBe("stale");
  });

  it("falls back to fetchedAt for freshness only when sourceUpdatedAt is null (legacy rows, or a provider with no real per-symbol timestamp)", async () => {
    vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue({ pctLong: 58, pctShort: 42, provider: "myfxbook", source: "Myfxbook Community Outlook", fetchedAt: hoursAgo(1), sourceUpdatedAt: null });

    const result = await getRetailSentimentFromStorage("EURUSD");

    expect(result.status).toBe("live");
  });

  it("remains UNAVAILABLE when no valid observation has ever existed — never fabricates a snapshot", async () => {
    vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue(null);

    const result = await getRetailSentimentFromStorage("BTCUSD");

    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
  });
});
