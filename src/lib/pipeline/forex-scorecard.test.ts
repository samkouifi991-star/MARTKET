import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./economic-strength", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./economic-strength")>();
  return { ...actual, computeCurrencyStrength: vi.fn() };
});
vi.mock("./macro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./macro")>();
  return { ...actual, fetchLatestRates: vi.fn() };
});
vi.mock("./technical", () => ({ fetchTechnicalTrend: vi.fn() }));
vi.mock("@/db/queries/economic-releases");
vi.mock("@/services/market-data/last-known-good", () => ({ getRetailSentimentFromStorage: vi.fn() }));
vi.mock("@/db/queries/scores", () => ({ getCurrentScore: vi.fn() }));

import { computeCurrencyStrength } from "./economic-strength";
import { fetchLatestRates } from "./macro";
import { fetchTechnicalTrend } from "./technical";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";
import { getRetailSentimentFromStorage } from "@/services/market-data/last-known-good";
import { getCurrentScore } from "@/db/queries/scores";
import { buildForexScorecard, FX_PAIRS } from "./forex-scorecard";

function strength(currency: string, country: string, score: number | null) {
  return { currency, country, score, level: score !== null ? ("Strong" as const) : null, drivers: [], freshness: "live" as const };
}

describe("FX_PAIRS", () => {
  it("only includes FX instruments with currencies", () => {
    expect(FX_PAIRS.length).toBeGreaterThan(0);
    expect(FX_PAIRS).toContain("GBPUSD");
  });
});

describe("buildForexScorecard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(computeCurrencyStrength).mockImplementation(async (currency: string) => (currency === "GBP" ? strength("GBP", "GB", 40) : strength("JPY", "JP", -30)));
    vi.mocked(fetchLatestRates).mockImplementation(async (country: string) => (country === "GB" ? { policyRate: 5, trend: 1, freshness: "live" } : { policyRate: 0.5, trend: -1, freshness: "live" }));
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);
    vi.mocked(fetchTechnicalTrend).mockResolvedValue({
      daily: { provider: "oanda", source: "OANDA", status: "live", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: [] },
      h4: { provider: "oanda", source: "OANDA", status: "live", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: [] },
      h1: { provider: "oanda", source: "OANDA", status: "live", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: [] },
      result: {
        rawScore: 3,
        explanation: "",
        currentPrice: 180,
        sma20: null,
        sma50: null,
        sma100: null,
        sma200: null,
        rsi14: null,
        adx14: null,
        atr14: null,
        roc10: null,
        structure: "Choppy / Mixed",
        timeframes: [
          { timeframe: "daily", score: 2, bullishMaCount: 0, availableMaCount: 0, structure: "Choppy / Mixed", adx: null, rsi: null, macdHistogram: null, roc: null },
          { timeframe: "4h", score: -1, bullishMaCount: 0, availableMaCount: 0, structure: "Choppy / Mixed", adx: null, rsi: null, macdHistogram: null, roc: null },
          { timeframe: "1h", score: 0, bullishMaCount: 0, availableMaCount: 0, structure: "Choppy / Mixed", adx: null, rsi: null, macdHistogram: null, roc: null },
        ],
      },
    });
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({
      provider: "oanda",
      source: "OANDA",
      status: "live",
      fetchedAt: "",
      sourceUpdatedAt: null,
      nextExpectedUpdate: null,
      value: { symbol: "GBPJPY", pctLong: 70, pctShort: 30 },
    });
    vi.mocked(getCurrentScore).mockResolvedValue({ symbol: "GBPJPY", totalScore: 4.2, bias: "Bullish", confidence: 80, change24h: 0, factors: [], history: [], lastUpdated: "" } as never);
  });

  it("computes strength/rate/surprise differentials base minus quote", async () => {
    const data = await buildForexScorecard("GBPJPY", true);
    expect(data.base).toBe("GBP");
    expect(data.quote).toBe("JPY");
    expect(data.strengthDifferential).toBe(70); // 40 - (-30)
    expect(data.rateDifferentialPts).toBe(4.5); // 5 - 0.5
  });

  it("maps per-timeframe technical scores to trend labels", async () => {
    const data = await buildForexScorecard("GBPJPY", true);
    expect(data.dailyTrend).toBe("Bullish");
    expect(data.h4Trend).toBe("Bearish");
    expect(data.h1Trend).toBe("Neutral");
  });

  it("flags crowded-long retail sentiment as a bearish contrarian bias", async () => {
    const data = await buildForexScorecard("GBPJPY", true);
    expect(data.retail).toEqual({ pctLong: 70, pctShort: 30, contrarianBias: "Bearish" });
  });

  it("uses the real canonical score for finalScore/finalBias", async () => {
    const data = await buildForexScorecard("GBPJPY", true);
    expect(data.finalScore).toBe(4.2);
    expect(data.finalBias).toBe("Bullish");
  });

  it("throws for a non-FX symbol", async () => {
    await expect(buildForexScorecard("XAUUSD", true)).rejects.toThrow(/not a tracked FX pair/);
  });
});
