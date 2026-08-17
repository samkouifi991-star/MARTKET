import { describe, expect, it } from "vitest";
import { adx, atr, detectStructure, ema, macd, roc, rsi, sma } from "./indicators";
import { buildChoppyCandles, buildTrendingCandles } from "./__fixtures__/candles";

describe("sma/ema", () => {
  it("returns null when there isn't enough history", () => {
    expect(sma([1, 2, 3], 5)).toBeNull();
    expect(ema([1, 2, 3], 5)).toBeNull();
  });

  it("computes a simple average over the trailing window", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([10, 1, 2, 3, 4, 5], 5)).toBe(3); // only trailing 5 count
  });
});

describe("rsi", () => {
  it("is 100 when every move is a gain", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(closes, 14)).toBe(100);
  });

  it("is 0 when every move is a loss", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(closes, 14)).toBe(0);
  });

  it("sits near 50 for a flat/choppy series", () => {
    const candles = buildChoppyCandles(60);
    const value = rsi(candles.map((c) => c.close), 14);
    expect(value).not.toBeNull();
    expect(value!).toBeGreaterThan(20);
    expect(value!).toBeLessThan(80);
  });
});

describe("macd", () => {
  it("is positive in a sustained uptrend", () => {
    const candles = buildTrendingCandles({ bars: 80, startPrice: 100, trendPerBar: 0.6, noise: 0.3 });
    const result = macd(candles.map((c) => c.close));
    expect(result).not.toBeNull();
    expect(result!.histogram).toBeGreaterThan(0);
  });
});

describe("atr", () => {
  it("is null with too little history", () => {
    expect(atr(buildChoppyCandles(5), 14)).toBeNull();
  });

  it("scales with the size of the wiggle", () => {
    const calm = buildTrendingCandles({ bars: 40, startPrice: 100, trendPerBar: 0, noise: 0.1, seed: 1 });
    const wild = buildTrendingCandles({ bars: 40, startPrice: 100, trendPerBar: 0, noise: 3, seed: 1 });
    expect(atr(wild, 14)!).toBeGreaterThan(atr(calm, 14)!);
  });
});

describe("adx", () => {
  it("is null with too little history", () => {
    expect(adx(buildChoppyCandles(10), 14)).toBeNull();
  });

  it("reads higher for a strong sustained trend than a choppy range", () => {
    const trending = buildTrendingCandles({ bars: 80, startPrice: 100, trendPerBar: 1, noise: 0.2, seed: 3 });
    const choppy = buildChoppyCandles(80, 100, 3);
    const trendingAdx = adx(trending, 14);
    const choppyAdx = adx(choppy, 14);
    expect(trendingAdx).not.toBeNull();
    expect(choppyAdx).not.toBeNull();
    expect(trendingAdx!).toBeGreaterThan(choppyAdx!);
  });
});

describe("roc", () => {
  it("is positive after a steady climb", () => {
    const candles = buildTrendingCandles({ bars: 30, startPrice: 100, trendPerBar: 1, noise: 0 });
    expect(roc(candles.map((c) => c.close), 10)!).toBeGreaterThan(0);
  });
});

describe("detectStructure", () => {
  it("identifies higher highs & higher lows in an uptrend", () => {
    const candles = buildTrendingCandles({ bars: 60, startPrice: 100, trendPerBar: 0.8, noise: 0.2, seed: 9 });
    expect(detectStructure(candles, 20)).toBe("Higher Highs & Higher Lows");
  });

  it("identifies lower highs & lower lows in a downtrend", () => {
    const candles = buildTrendingCandles({ bars: 60, startPrice: 100, trendPerBar: -0.8, noise: 0.2, seed: 9 });
    expect(detectStructure(candles, 20)).toBe("Lower Highs & Lower Lows");
  });

  it("falls back to choppy/mixed with too little history", () => {
    expect(detectStructure(buildChoppyCandles(10), 20)).toBe("Choppy / Mixed");
  });
});
