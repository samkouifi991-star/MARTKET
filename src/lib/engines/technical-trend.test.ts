import { describe, expect, it } from "vitest";
import { computeTechnicalTrend } from "./technical-trend";
import { buildChoppyCandles, buildTrendingCandles } from "./__fixtures__/candles";

describe("computeTechnicalTrend", () => {
  it("returns null when daily history is too short", () => {
    expect(computeTechnicalTrend({ daily: buildChoppyCandles(5) })).toBeNull();
  });

  it("scores a sustained uptrend positive with a bullish explanation", () => {
    const daily = buildTrendingCandles({ bars: 260, startPrice: 1.08, trendPerBar: 0.0015, noise: 0.001, seed: 11 });
    const result = computeTechnicalTrend({ daily });
    expect(result).not.toBeNull();
    expect(result!.rawScore).toBeGreaterThan(0);
    expect(result!.structure).toBe("Higher Highs & Higher Lows");
    expect(result!.explanation.toLowerCase()).toContain("above");
  });

  it("scores a sustained downtrend negative with a bearish explanation", () => {
    const daily = buildTrendingCandles({ bars: 260, startPrice: 1.08, trendPerBar: -0.0015, noise: 0.001, seed: 11 });
    const result = computeTechnicalTrend({ daily });
    expect(result).not.toBeNull();
    expect(result!.rawScore).toBeLessThan(0);
    expect(result!.structure).toBe("Lower Highs & Lower Lows");
    expect(result!.explanation.toLowerCase()).toContain("below");
  });

  it("stays within -10..10 regardless of trend strength", () => {
    const daily = buildTrendingCandles({ bars: 260, startPrice: 100, trendPerBar: 2, noise: 0.1, seed: 5 });
    const result = computeTechnicalTrend({ daily });
    expect(result!.rawScore).toBeLessThanOrEqual(10);
    expect(result!.rawScore).toBeGreaterThanOrEqual(-10);
  });

  it("blends in 4h/1h timeframes and notes agreement or divergence", () => {
    const daily = buildTrendingCandles({ bars: 260, startPrice: 1.08, trendPerBar: 0.0015, noise: 0.001, seed: 11 });
    const h4 = buildTrendingCandles({ bars: 200, startPrice: 1.08, trendPerBar: 0.0004, noise: 0.0008, seed: 12 });
    const h1 = buildTrendingCandles({ bars: 200, startPrice: 1.08, trendPerBar: -0.0006, noise: 0.0008, seed: 13 });
    const result = computeTechnicalTrend({ daily, h4, h1 });
    expect(result).not.toBeNull();
    expect(result!.timeframes.length).toBe(3);
    expect(result!.explanation).toMatch(/intraday timeframes (confirm|diverge from)/i);
  });

  it("flags an overextended RSI without necessarily flipping the sign", () => {
    // A sharp, mostly-one-directional run pushes RSI into overbought territory.
    const daily = buildTrendingCandles({ bars: 260, startPrice: 100, trendPerBar: 1.2, noise: 0.05, seed: 21 });
    const result = computeTechnicalTrend({ daily });
    expect(result!.rsi14).not.toBeNull();
    if (result!.rsi14! > 70) {
      expect(result!.explanation).toContain("overextended");
      expect(result!.rawScore).toBeGreaterThan(0); // still bullish — RSI doesn't reverse the score
    }
  });
});
