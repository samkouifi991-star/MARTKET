import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTrendingCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/market-data-router");
vi.mock("@/db/queries/market-data");
import * as marketData from "@/services/market-data/market-data-router";
import { getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { resolveTechnicalFactor } from "./technical";

const dailyCandles: NormalizedCandle[] = buildTrendingCandles({ bars: 260, startPrice: 1.24, trendPerBar: 0.0012, noise: 0.0008, seed: 55 });

function liveCandles(value: NormalizedCandle[], provider: "fmp" | "oanda" = "fmp") {
  return {
    provider,
    source: provider === "oanda" ? "OANDA v20" : "Financial Modeling Prep",
    status: "live" as const,
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: value[value.length - 1]?.date ?? new Date().toISOString(),
    nextExpectedUpdate: null,
    value,
  };
}

const planLimited = (interval: string) => ({
  provider: "fmp" as const,
  source: "Financial Modeling Prep",
  status: "unavailable" as const,
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: `provider plan does not include intraday candles (${interval})`,
});

beforeEach(() => vi.resetAllMocks());

describe("resolveTechnicalFactor — intraday plan-limitation handling", () => {
  it("still computes a live-quality result from daily candles alone when 4H/1H are plan-limited (402)", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(liveCandles(dailyCandles));
    vi.mocked(marketData.getIntradayCandles).mockImplementation(async (_symbol, interval) => planLimited(interval));

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed"); // real live daily data, but partial — not "live" (full), not "stale"/"error"
    expect(factor.explanation).toContain("Missing intraday confirmation");
    expect(factor.source).not.toMatch(/D \+ H4|D \+ H1/); // must not claim intraday sources it didn't actually use
    expect(factor.source).toMatch(/H4, H1 unavailable/); // but honestly names what's missing
    expect(factor.rawScore).not.toBe(0); // still a real computed score, not blocked
  });

  it("reports full multi-timeframe provenance and live freshness when 4H/1H both succeed", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(liveCandles(dailyCandles));
    vi.mocked(marketData.getIntradayCandles).mockImplementation(async (_symbol, interval) =>
      liveCandles(buildTrendingCandles({ bars: 200, startPrice: 1.24, trendPerBar: 0.0003, noise: 0.0005, seed: interval === "4hour" ? 56 : 57 }))
    );

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("live");
    expect(factor.source).toMatch(/D \+ H4 \+ H1/);
    expect(factor.explanation).not.toContain("Missing intraday confirmation");
  });

  it("names each provider separately in the source label when daily and intraday come from different providers", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(liveCandles(dailyCandles, "oanda"));
    vi.mocked(marketData.getIntradayCandles).mockImplementation(async (_symbol, interval) =>
      liveCandles(buildTrendingCandles({ bars: 200, startPrice: 1.24, trendPerBar: 0.0003, noise: 0.0005, seed: interval === "4hour" ? 56 : 57 }), "fmp")
    );

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.source).toMatch(/OANDA D candles/);
    expect(factor.source).toMatch(/FMP H4 \+ H1 candles/);
  });

  it("distinguishes a genuine intraday error from a plan limitation in the explanation", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(liveCandles(dailyCandles));
    vi.mocked(marketData.getIntradayCandles).mockImplementation(async (_symbol, interval) =>
      interval === "4hour"
        ? { provider: "fmp" as const, source: "Financial Modeling Prep", status: "error" as const, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "network timeout" }
        : planLimited(interval)
    );

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.explanation).toContain("H4");
    expect(factor.explanation).toContain("H1");
  });
});

describe("resolveTechnicalFactor — last-known-good fallback during a provider outage", () => {
  const down = { provider: "fmp" as const, source: "Financial Modeling Prep", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "RATE_LIMITED — FMP returned 429 Too Many Requests" };

  it("computes a real result from stored candles (DELAYED, not UNAVAILABLE) when the live daily fetch fails but real candles are stored", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(marketData.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles: dailyCandles, fetchedAt: new Date(Date.now() - 3 * 3_600_000), provider: "fmp" }); // 3h old -> recent

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.rawScore).not.toBe(0); // real computed value, not zeroed out
    expect(factor.explanation).toMatch(/stored candles/i);
    expect(factor.source).toMatch(/last known good/i);
  });

  it("still returns unavailable — not a fabricated result — when there is no stored fallback either", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(marketData.getIntradayCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue(null);

    const factor = await resolveTechnicalFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("unavailable");
    expect(factor.rawScore).toBe(0);
  });
});
