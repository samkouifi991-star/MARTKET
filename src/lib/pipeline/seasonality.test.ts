import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildMultiYearDailyCandles } from "@/lib/engines/__fixtures__/candles";
import type { NormalizedCandle } from "@/services/types";

vi.mock("@/services/market-data/market-data-router");
vi.mock("@/db/queries/market-data");
import * as marketData from "@/services/market-data/market-data-router";
import { getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { resolveSeasonalityFactor } from "./seasonality";

// 12 years so the sample clears the 10-year "normal confidence" tier —
// used for the plain live/DELAYED/STALE fallback tests below. The
// dedicated sample-depth tiering tests use their own shorter fixtures.
const multiYearCandles: NormalizedCandle[] = buildMultiYearDailyCandles({ years: 12, startYear: 2013, startPrice: 1.24, monthBiasPctPerDay: () => 0.02, seed: 55 });

const down = { provider: "fmp" as const, source: "Financial Modeling Prep", status: "unavailable" as const, fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null, error: "RATE_LIMITED — FMP returned 429 Too Many Requests" };

beforeEach(() => vi.resetAllMocks());

describe("resolveSeasonalityFactor — last-known-good fallback during an FMP outage", () => {
  it("computes a real result from stored history (DELAYED, not UNAVAILABLE) when the live fetch fails but multi-year candles are stored", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles: multiYearCandles, fetchedAt: new Date(Date.now() - 3 * 3_600_000), provider: "fmp" });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.explanation).toMatch(/stored candles/i);
    expect(factor.source).toMatch(/last known good/i);
  });

  it("classifies older stored history as STALE, not DELAYED, while still using the real data", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue({ candles: multiYearCandles, fetchedAt: new Date(Date.now() - 200 * 3_600_000), provider: "fmp" });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("stale");
  });

  it("still returns unavailable — not a fabricated result — when there is no stored fallback either", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue(down);
    vi.mocked(getLatestStoredDailyCandles).mockResolvedValue(null);

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("unavailable");
    expect(factor.rawScore).toBe(0);
  });

  it("reports live freshness when the live fetch succeeds directly (fallback never consulted)", async () => {
    vi.mocked(marketData.getDailyCandles).mockResolvedValue({
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

describe("resolveSeasonalityFactor — historical sample depth (real span, not just period-occurrence count)", () => {
  it("treats a ~1-year sample as UNAVAILABLE (INSUFFICIENT_HISTORY), even when the live fetch itself succeeds — the exact GBPUSD 228-candle scenario", async () => {
    // ~1 year of daily candles — this is deliberately the real-world shape
    // of the bug report: a thin sample that could still make the current
    // month "appear twice" (once near each edge) and look falsely
    // multi-year if gated on period-occurrence count instead of real span.
    const oneYearCandles = buildMultiYearDailyCandles({ years: 1, startYear: 2025, startPrice: 1.27, monthBiasPctPerDay: () => 0.01, seed: 3 });
    vi.mocked(marketData.getDailyCandles).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: oneYearCandles[oneYearCandles.length - 1].date,
      nextExpectedUpdate: null,
      value: oneYearCandles,
    });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("unavailable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/1 year|below the 3-year minimum/i);
    // Must never claim a large multi-year sample when the real dataset is thin.
    expect(factor.explanation).not.toMatch(/19-year|20-year|10-year/i);
  });

  it("classifies a 4-year sample as STALE/low-confidence, not full-confidence live", async () => {
    const fourYearCandles = buildMultiYearDailyCandles({ years: 4, startYear: 2021, startPrice: 1.24, monthBiasPctPerDay: () => 0.015, seed: 11 });
    vi.mocked(marketData.getDailyCandles).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: fourYearCandles[fourYearCandles.length - 1].date,
      nextExpectedUpdate: null,
      value: fourYearCandles,
    });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("stale");
    expect(factor.rawScore).not.toBe(0); // still usable, just lower confidence
    expect(factor.source).toMatch(/4-year sample/);
  });

  it("classifies a 7-year sample as DELAYED/reduced-confidence, not full-confidence live", async () => {
    const sevenYearCandles = buildMultiYearDailyCandles({ years: 7, startYear: 2018, startPrice: 1.3, monthBiasPctPerDay: () => 0.015, seed: 21 });
    vi.mocked(marketData.getDailyCandles).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: sevenYearCandles[sevenYearCandles.length - 1].date,
      nextExpectedUpdate: null,
      value: sevenYearCandles,
    });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.source).toMatch(/7-year sample/);
  });

  it("reports full live confidence only at 10+ years of real span", async () => {
    const tenYearCandles = buildMultiYearDailyCandles({ years: 10, startYear: 2015, startPrice: 1.3, monthBiasPctPerDay: () => 0.015, seed: 31 });
    vi.mocked(marketData.getDailyCandles).mockResolvedValue({
      provider: "fmp",
      source: "Financial Modeling Prep",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: tenYearCandles[tenYearCandles.length - 1].date,
      nextExpectedUpdate: null,
      value: tenYearCandles,
    });

    const factor = await resolveSeasonalityFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("live");
    expect(factor.source).toMatch(/10-year sample/);
  });
});
