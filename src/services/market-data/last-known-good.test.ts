import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./fmp");
vi.mock("@/db/queries/market-data");

import * as fmp from "./fmp";
import { getLatestStoredPrice, getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { getQuoteWithFallback, getDailyCandlesWithFallback } from "./last-known-good";

const down = { provider: "fmp" as const, source: "n/a", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "RATE_LIMITED" };

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

beforeEach(() => vi.resetAllMocks());

describe("getQuoteWithFallback", () => {
  it("passes through the live result unchanged when the live call succeeds", async () => {
    const live = { provider: "fmp" as const, source: "FMP", status: "live" as const, fetchedAt: "now", sourceUpdatedAt: "now", nextExpectedUpdate: null, value: { symbol: "GBPUSD", price: 1.3, changePct24h: 0.1, timestamp: "now" } };
    vi.mocked(fmp.getQuote).mockResolvedValue(live);

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result).toBe(live);
    expect(getLatestStoredPrice).not.toHaveBeenCalled();
  });

  it("falls back to a recently-stored price as DELAYED when the live call fails", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue({ price: 1.36388, changePct24h: 0.2, provider: "fmp", sourceUpdatedAt: hoursAgo(2), fetchedAt: hoursAgo(2) });

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result.status).toBe("delayed");
    expect(result.value?.price).toBe(1.36388);
    expect(result.fetchedAt).not.toBe(new Date().toISOString().slice(0, 10)); // not "now" — the real stored timestamp
    expect(new Date(result.fetchedAt).getTime()).toBeLessThan(Date.now() - 3_600_000);
  });

  it("classifies an old stored price as STALE, not DELAYED", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue({ price: 1.36388, changePct24h: 0.2, provider: "fmp", sourceUpdatedAt: hoursAgo(200), fetchedAt: hoursAgo(200) });

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result.status).toBe("stale");
    expect(result.value?.price).toBe(1.36388); // real value still returned, not erased
  });

  it("reports UNAVAILABLE (the live result, unchanged) only when there has never been a stored value", async () => {
    vi.mocked(fmp.getQuote).mockResolvedValue(down);
    vi.mocked(getLatestStoredPrice).mockResolvedValue(null);

    const result = await getQuoteWithFallback("GBPUSD");

    expect(result).toBe(down);
    expect(result.status).toBe("unavailable");
  });
});

describe("getDailyCandlesWithFallback", () => {
  it("falls back to stored candles as DELAYED when the live call fails, preserving the real candle count", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    const candles = Array.from({ length: 228 }, (_, i) => ({ date: new Date(Date.now() - i * 86_400_000).toISOString(), open: 1, high: 1.01, low: 0.99, close: 1.005, volume: null }));
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles, fetchedAt: hoursAgo(3) });

    const result = await getDailyCandlesWithFallback("GBPUSD");

    expect(result.status).toBe("delayed");
    expect(result.value).toHaveLength(228);
  });

  it("never claims a stored value came from 'now' — fetchedAt reflects the real storage time", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    const storedAt = hoursAgo(50); // beyond the 36h "delayed" window
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({
      candles: [{ date: hoursAgo(50).toISOString(), open: 1, high: 1.01, low: 0.99, close: 1.005, volume: null }],
      fetchedAt: storedAt,
    });

    const result = await getDailyCandlesWithFallback("GBPUSD");

    expect(result.status).toBe("stale");
    expect(result.fetchedAt).toBe(storedAt.toISOString());
  });
});
