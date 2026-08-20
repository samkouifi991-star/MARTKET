import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildMultiYearDailyCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/fmp");
vi.mock("@/db/queries/market-data");
import * as fmp from "@/services/market-data/fmp";
import { getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { resolveSeasonalityFactor } from "./seasonality";

// 5 years so the MIN_YEARS_FOR_LIVE (2) minimum is comfortably met.
const multiYearCandles: NormalizedCandle[] = buildMultiYearDailyCandles({ years: 5, startYear: 2020, startPrice: 1.24, monthBiasPctPerDay: () => 0.02, seed: 55 });

const down = { provider: "fmp" as const, source: "Financial Modeling Prep", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "RATE_LIMITED — FMP returned 429 Too Many Requests" };

beforeEach(() => vi.resetAllMocks());

describe("resolveSeasonalityFactor — last-known-good fallback during an FMP outage", () => {
  it("computes a real result from stored history (DELAYED, not UNAVAILABLE) when the live fetch fails but multi-year candles are stored", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles: multiYearCandles, fetchedAt: new Date(Date.now() - 3 * 3_600_000) });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.explanation).toMatch(/last successfully stored|stored daily candles/i);
    expect(factor.source).toMatch(/last known good/i);
  });

  it("classifies older stored history as STALE, not DELAYED, while still using the real data", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles: multiYearCandles, fetchedAt: new Date(Date.now() - 200 * 3_600_000) });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("stale");
  });

  it("still returns unavailable — not a fabricated result — when there is no stored fallback either", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue(null);

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("unavailable");
    expect(factor.rawScore).toBe(0);
  });

  it("reports live freshness when the live fetch succeeds directly (fallback never consulted)", async () => {
    vi.mocked(fmp.getDailyCandles).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: multiYearCandles[multiYearCandles.length - 1].date,
      nextExpectedUpdate: null,
      value: multiYearCandles,
    });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("live");
    expect(getLatestStoredDailyCandles).not.toHaveBeenCalled();
    // lastUpdated must be the real candle date, not page-render/computation
    // time — the exact "Last updated just now" bug this factor previously had.
    expect(factor.lastUpdated).toBe(multiYearCandles[multiYearCandles.length - 1].date);
  });
});
