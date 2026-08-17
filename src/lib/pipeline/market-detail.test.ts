import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildMultiYearDailyCandles, buildTrendingCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/fmp");
vi.mock("@/services/market-data/cftc");
vi.mock("@/services/market-data/retail-sentiment");

import * as fmp from "@/services/market-data/fmp";
import * as cftc from "@/services/market-data/cftc";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { getLiveMarketDetail } from "./market-detail";

const dailyCandles: NormalizedCandle[] = buildTrendingCandles({ bars: 260, startPrice: 1.24, trendPerBar: 0.0012, noise: 0.0008, seed: 55 });
// A multi-year series so the seasonality card's 2-year minimum is met —
// mirrors how resolveSeasonalityFactor requests much more history than the
// technical-trend resolver's default 260-day window.
const multiYearCandles: NormalizedCandle[] = buildMultiYearDailyCandles({ years: 5, startYear: 2020, startPrice: 1.24, monthBiasPctPerDay: () => 0.02, seed: 55 });

function mockAllLive() {
  vi.mocked(fmp.getQuote).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: { symbol: "GBPUSD", price: dailyCandles[dailyCandles.length - 1].close, changePct24h: 0.3, timestamp: new Date().toISOString() },
  });
  vi.mocked(fmp.getDailyCandles).mockImplementation(async (_symbol, days = 260) => ({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: dailyCandles[dailyCandles.length - 1].date,
    nextExpectedUpdate: null,
    value: days > 1000 ? multiYearCandles : dailyCandles,
  }));
  vi.mocked(fmp.getIntradayCandles).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: buildTrendingCandles({ bars: 200, startPrice: 1.24, trendPerBar: 0.0003, noise: 0.0005, seed: 56 }),
  });

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
    },
  });

  vi.mocked(retailSentiment.getRetailSentiment).mockResolvedValue({
    provider: "myfxbook",
    source: "Myfxbook Community Outlook",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: { symbol: "GBPUSD", pctLong: 62, pctShort: 38 },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("getLiveMarketDetail", () => {
  it("assembles every card as live when all providers succeed", async () => {
    mockAllLive();

    const detail = await getLiveMarketDetail("GBPUSD", "live");

    expect(detail.price.freshness).toBe("live");
    expect(detail.price.data?.current).toBeGreaterThan(0);
    expect(detail.institutional.freshness).toBe("live");
    expect(detail.institutional.data?.classification).toBe("Asset Manager");
    expect(detail.retail.freshness).toBe("live");
    expect(detail.retail.data?.pctLong).toBe(62);
    expect(detail.smartMoney.freshness).toBe("live");
    expect(detail.seasonality.freshness).toBe("live");
  });

  it("never fabricates a value in live mode — every card goes unavailable/error with null data when providers fail", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(retailSentiment.getRetailSentiment).mockResolvedValue(down);

    const detail = await getLiveMarketDetail("GBPUSD", "live");

    expect(detail.price.data).toBeNull();
    expect(detail.institutional.data).toBeNull();
    expect(detail.retail.data).toBeNull();
    expect(detail.smartMoney.data).toBeNull();
    expect(detail.seasonality.data).toBeNull();
    expect([detail.price.freshness, detail.institutional.freshness, detail.retail.freshness, detail.smartMoney.freshness, detail.seasonality.freshness]).toEqual(
      expect.arrayContaining(["unavailable"])
    );
  });

  it("in hybrid mode for an ordinary (non-strict-live) symbol, falls back to clearly-labeled demo data for institutional/seasonality/price but never for retail sentiment", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(retailSentiment.getRetailSentiment).mockResolvedValue(down);

    const detail = await getLiveMarketDetail("EURUSD", "hybrid");

    expect(detail.price.freshness).toBe("estimated");
    expect(detail.institutional.freshness).toBe("estimated");
    expect(detail.seasonality.freshness).toBe("estimated");
    expect(detail.retail.freshness).toBe("unavailable");
    expect(detail.retail.data).toBeNull();
  });

  it("in hybrid mode for GBPUSD (strict-live), never falls back to demo data for any card", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(fmp.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    vi.mocked(retailSentiment.getRetailSentiment).mockResolvedValue(down);

    const detail = await getLiveMarketDetail("GBPUSD", "hybrid");

    expect(detail.price.freshness).not.toBe("estimated");
    expect(detail.institutional.freshness).not.toBe("estimated");
    expect(detail.seasonality.freshness).not.toBe("estimated");
    expect(detail.price.data).toBeNull();
    expect(detail.institutional.data).toBeNull();
    expect(detail.seasonality.data).toBeNull();
  });
});
