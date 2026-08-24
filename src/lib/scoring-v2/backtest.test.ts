import { describe, expect, it } from "vitest";
import { BacktestSample, CandleClose, FactorHistoryPoint, combinedSignal, factorSignal, forwardReturns, hadEventShock, runBacktest, summarizeSamples } from "./backtest";

function candle(date: string, close: number): CandleClose {
  return { date, close };
}

describe("forwardReturns", () => {
  const candles = [candle("2027-01-01", 100), candle("2027-01-02", 110), candle("2027-01-03", 90), candle("2027-01-04", 120)];

  it("computes a real forward return for each horizon that has enough future data", () => {
    const result = forwardReturns(candles, "2027-01-01", [1, 2, 3]);
    expect(result[1]).toBeCloseTo(0.1, 5); // 100 -> 110
    expect(result[2]).toBeCloseTo(-0.1, 5); // 100 -> 90
    expect(result[3]).toBeCloseTo(0.2, 5); // 100 -> 120
  });

  it("omits a horizon with no real forward data yet — never fabricates one", () => {
    const result = forwardReturns(candles, "2027-01-03", [1, 5]);
    expect(result[1]).toBeCloseTo((120 - 90) / 90, 5);
    expect(result[5]).toBeUndefined();
  });

  it("returns an empty object when the as-of date isn't in the candle series at all", () => {
    expect(forwardReturns(candles, "2027-06-01")).toEqual({});
  });
});

describe("summarizeSamples", () => {
  it("reports a perfect predictor as 100% hit rate with a positive average return and zero drawdown", () => {
    const samples: BacktestSample[] = [
      { date: "d1", signal: 1, forwardReturn: 0.02 },
      { date: "d2", signal: -1, forwardReturn: -0.03 },
      { date: "d3", signal: 1, forwardReturn: 0.01 },
    ];
    const stat = summarizeSamples(samples, 5);
    expect(stat.sampleSize).toBe(3);
    expect(stat.hitRate).toBe(100);
    expect(stat.directionalAccuracy).toBe(100);
    expect(stat.avgReturn).toBeGreaterThan(0);
    expect(stat.maxDrawdown).toBe(0); // equity curve never dips below its own running peak
  });

  it("reports an always-wrong predictor as 0% hit rate with a negative average return", () => {
    const samples: BacktestSample[] = [
      { date: "d1", signal: 1, forwardReturn: -0.02 },
      { date: "d2", signal: -1, forwardReturn: 0.03 },
    ];
    const stat = summarizeSamples(samples, 5);
    expect(stat.hitRate).toBe(0);
    expect(stat.avgReturn).toBeLessThan(0);
    expect(stat.maxDrawdown).toBeLessThan(0);
  });

  it("excludes neutral (signal=0) samples from hitRate but still counts them in directionalAccuracy and sampleSize", () => {
    const samples: BacktestSample[] = [
      { date: "d1", signal: 1, forwardReturn: 0.02 }, // correct
      { date: "d2", signal: 0, forwardReturn: 0.05 }, // neutral — never "correct"
    ];
    const stat = summarizeSamples(samples, 1);
    expect(stat.sampleSize).toBe(2);
    expect(stat.hitRate).toBe(100); // 1/1 decisive sample correct
    expect(stat.directionalAccuracy).toBe(50); // 1/2 of ALL samples correct
  });

  it("computes a real peak-to-trough max drawdown on a losing streak", () => {
    // Cumulative edge-return path: +0.05, -0.10 (peak 0.05, trough -0.05 => drawdown -0.10), +0.02
    const samples: BacktestSample[] = [
      { date: "d1", signal: 1, forwardReturn: 0.05 },
      { date: "d2", signal: 1, forwardReturn: -0.1 },
      { date: "d3", signal: 1, forwardReturn: 0.02 },
    ];
    const stat = summarizeSamples(samples, 1);
    expect(stat.maxDrawdown).toBeCloseTo(-0.1, 5);
  });

  it("returns all nulls for zero samples — never a fabricated 0% or 50%", () => {
    const stat = summarizeSamples([], 10);
    expect(stat).toEqual({ horizonDays: 10, sampleSize: 0, hitRate: null, directionalAccuracy: null, avgReturn: null, maxDrawdown: null });
  });
});

describe("factorSignal / combinedSignal / hadEventShock", () => {
  const point: FactorHistoryPoint = {
    date: "2027-01-01",
    factors: [
      { key: "inflation", contribution: 1.5 },
      { key: "interestRates", contribution: -0.5 },
      { key: "event", contribution: 2 },
    ],
  };

  it("reads a single factor's real stored contribution", () => {
    expect(factorSignal(point, "inflation")).toBe(1.5);
  });

  it("returns 0 (neutral, not fabricated) for a factor not present that cycle", () => {
    expect(factorSignal(point, "technical")).toBe(0);
  });

  it("sums several factors into one combined signal", () => {
    expect(combinedSignal(point, ["inflation", "interestRates"])).toBeCloseTo(1.0, 5);
  });

  it("detects a real, non-zero event-shock contribution", () => {
    expect(hadEventShock(point)).toBe(true);
    expect(hadEventShock({ date: "d", factors: [{ key: "event", contribution: 0 }] })).toBe(false);
    expect(hadEventShock({ date: "d", factors: [] })).toBe(false);
  });
});

describe("runBacktest", () => {
  const candles = [candle("2027-01-01", 100), candle("2027-01-02", 105), candle("2027-01-03", 95), candle("2027-01-04", 100), candle("2027-01-05", 108)];

  const history: FactorHistoryPoint[] = [
    { date: "2027-01-01", factors: [{ key: "inflation", contribution: 2 }, { key: "event", contribution: 1 }] },
    { date: "2027-01-02", factors: [{ key: "inflation", contribution: -1 }, { key: "event", contribution: 0 }] },
    { date: "2027-01-03", factors: [{ key: "inflation", contribution: 1.5 }, { key: "event", contribution: 3 }] },
  ];

  it("builds one stat per horizon, backed only by cycles with real forward data", () => {
    const result = runBacktest(history, candles, "inflation", (p) => factorSignal(p, "inflation"), undefined, [1, 2]);
    expect(result.label).toBe("inflation");
    expect(result.stats).toHaveLength(2);
    // 2027-01-04 and 2027-01-05 have no factor history, so at most 3 samples per horizon
    expect(result.stats[0].sampleSize).toBeLessThanOrEqual(3);
  });

  it("applies a filter (e.g. hadEventShock) before building samples", () => {
    const filtered = runBacktest(history, candles, "event-only", (p) => combinedSignal(p, ["inflation"]), hadEventShock, [1]);
    // Only 2027-01-01 and 2027-01-03 had a real non-zero event contribution
    expect(filtered.stats[0].sampleSize).toBe(2);
  });
});
