import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildMultiYearDailyCandles, buildTrendingCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/market-data-router");
vi.mock("@/services/market-data/cftc");
vi.mock("@/db/queries/market-data");

import * as marketData from "@/services/market-data/market-data-router";
import * as cftc from "@/services/market-data/cftc";
import { getLatestStoredPrice, getLatestStoredDailyCandles, getLatestStoredRetailSentiment } from "@/db/queries/market-data";
import { getLiveMarketDetail } from "./market-detail";

const dailyCandles: NormalizedCandle[] = buildTrendingCandles({ bars: 260, startPrice: 1.24, trendPerBar: 0.0012, noise: 0.0008, seed: 55 });
// A multi-year series so the seasonality card's 2-year minimum is met —
// mirrors how resolveSeasonalityFactor requests much more history than the
// technical-trend resolver's default 260-day window.
// 12 years so the sample clears the 10-year "normal confidence" tier —
// this fixture is meant to test the plain live/no-fallback path, not the
// sample-depth dampening (that has its own dedicated tests).
const multiYearCandles: NormalizedCandle[] = buildMultiYearDailyCandles({ years: 12, startYear: 2013, startPrice: 1.24, monthBiasPctPerDay: () => 0.02, seed: 55 });

function mockAllLive() {
  // Price/daily-candles are now a storage-only read (see price.ts's
  // getCanonicalPriceCard — Market Detail never calls the live provider for
  // price, matching Top Setups/Markets/Heatmap/Watchlists), so "all
  // providers succeed" for price means "a recent row exists in Neon," not
  // "the live router returns live" — mocking marketData.getQuote/
  // getDailyCandles here would never even be reached.
  vi.mocked(getLatestStoredPrice).mockResolvedValue({
    price: dailyCandles[dailyCandles.length - 1].close,
    changePct24h: 0.3,
    provider: "fmp",
    sourceUpdatedAt: new Date(),
    fetchedAt: new Date(),
  });
  vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({
    candles: dailyCandles,
    fetchedAt: new Date(),
    provider: "fmp",
  });
  // Smart Money (resolveSmartMoney, in positioning.ts) is a separate
  // consumer of getQuoteWithFallback that still calls it live-first
  // (storageOnly defaults to false there) — unrelated to, and out of scope
  // for, the price-card fix above, but still needs the router mocked so it
  // doesn't hit a real network call in this test.
  vi.mocked(marketData.getQuote).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: { symbol: "GBPUSD", price: dailyCandles[dailyCandles.length - 1].close, changePct24h: 0.3, timestamp: new Date().toISOString() },
  });
  vi.mocked(marketData.getIntradayCandles).mockResolvedValue({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: buildTrendingCandles({ bars: 200, startPrice: 1.24, trendPerBar: 0.0003, noise: 0.0005, seed: 56 }),
  });
  // Seasonality's daily-candle read is unaffected by the price fix (still
  // live-first, out of scope here) — it needs its own multi-year fixture
  // when the live router is asked for more than the technical default.
  vi.mocked(marketData.getDailyCandles).mockImplementation(async (_symbol, days = 260) => ({
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: dailyCandles[dailyCandles.length - 1].date,
    nextExpectedUpdate: null,
    value: days > 1000 ? multiYearCandles : dailyCandles,
  }));

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

  // Retail sentiment is read from storage only (see last-known-good.ts),
  // but freshness follows the OANDA source timestamp's own age, not how
  // recently the row was written — a fresh sourceUpdatedAt genuinely reads
  // "live" here, matching the "everything succeeded" fixture.
  vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue({
    pctLong: 62,
    pctShort: 38,
    provider: "oanda",
    source: "OANDA PositionBook",
    fetchedAt: new Date(),
    sourceUpdatedAt: new Date(),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: no last-known-good data stored — tests that want to exercise
  // the fallback set these explicitly. Without this, a live-call failure
  // would try to hit a real (unconfigured-in-tests) database instead of
  // taking the "never had data -> unavailable" path.
  vi.mocked(getLatestStoredPrice).mockResolvedValue(null);
  vi.mocked(getLatestStoredDailyCandles).mockResolvedValue(null);
  vi.mocked(getLatestStoredRetailSentiment).mockResolvedValue(null);
});

describe("getLiveMarketDetail", () => {
  it("assembles every card as live when all providers succeed", async () => {
    mockAllLive();

    const detail = await getLiveMarketDetail("GBPUSD", "live");

    // A storage-only read of a just-written row is honestly "delayed," not
    // "live" — "live" is reserved for a real-time provider call that just
    // succeeded, which Market Detail's price card no longer makes (see
    // price.ts's getCanonicalPriceCard) — matching the same convention
    // already used for CFTC/FRED/retail sentiment's storage-first reads.
    expect(detail.price.freshness).toBe("delayed");
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
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(marketData.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);
    // getLatestStoredRetailSentiment already defaults to null in beforeEach
    // — retail sentiment has no live call to fail, just no stored row.

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
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(marketData.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);

    // NAS100: all 10 configured OANDA FX pairs (through EURGBP/EURJPY, the
    // final batch) and every symbol with a real CFTC + myfxbook/IG mapping
    // are now promoted, so NAS100 is the ordinary, not-yet-promoted example
    // — blocked only by an unrelated FMP 402 issue on ^NDX. It has a real
    // CFTC mapping ("NASDAQ-100 Consolidated"), so institutionalCard()'s
    // demo fallback still applies normally ("estimated"), same as
    // price/seasonality. It has no myfxbook/IG/OANDA retail mapping at all,
    // so retail resolves NOT_APPLICABLE, not merely unavailable — demo
    // fallback must never invent a percentage either way.
    const detail = await getLiveMarketDetail("NAS100", "hybrid");

    expect(detail.price.freshness).toBe("estimated");
    expect(detail.institutional.freshness).toBe("estimated");
    expect(detail.seasonality.freshness).toBe("estimated");
    expect(detail.retail.freshness).toBe("not_applicable");
    expect(detail.retail.data).toBeNull();
  });

  it("in hybrid mode for GBPUSD (strict-live), never falls back to demo data for any card", async () => {
    const down = { status: "unavailable" as const, provider: "demo" as const, source: "n/a", fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    vi.mocked(marketData.getQuote).mockResolvedValue(down);
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(marketData.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue(down);

    const detail = await getLiveMarketDetail("GBPUSD", "hybrid");

    expect(detail.price.freshness).not.toBe("estimated");
    expect(detail.institutional.freshness).not.toBe("estimated");
    expect(detail.seasonality.freshness).not.toBe("estimated");
    expect(detail.price.data).toBeNull();
    expect(detail.institutional.data).toBeNull();
    expect(detail.seasonality.data).toBeNull();
  });
});
