import { describe, expect, it } from "vitest";
import { computeMonthlySeasonality, computeWeekdaySeasonality, computeCurrentMonthStat, computeHistoricalSampleDepth } from "./seasonality";
import { buildMultiYearDailyCandles } from "./__fixtures__/candles";

describe("computeMonthlySeasonality", () => {
  it("picks up a strong positive bias in a specific month (August) without inventing extra years", () => {
    const candles = buildMultiYearDailyCandles({
      years: 6,
      startYear: 2018,
      startPrice: 100,
      monthBiasPctPerDay: (month) => (month === 7 ? 0.4 : 0), // August = month index 7
      noise: 0.05,
    });

    const stats = computeMonthlySeasonality(candles);
    const august = stats.find((s) => s.period === "August")!;
    const january = stats.find((s) => s.period === "January")!;

    expect(august).toBeDefined();
    expect(august.avgReturn).toBeGreaterThan(january.avgReturn);
    expect(august.pctPositive).toBeGreaterThan(50);
    // Exactly 6 calendar Augusts exist in a 6-year fixture — never more.
    expect(august.years).toBe(6);
    expect(august.avg20y).toBeNull(); // fewer than 20 years of history provided
  });

  it("computes avg20y only once 20 real years of history exist", () => {
    const candles = buildMultiYearDailyCandles({
      years: 21,
      startYear: 2000,
      startPrice: 1.1,
      monthBiasPctPerDay: () => 0,
      noise: 0.01,
    });
    const stats = computeMonthlySeasonality(candles);
    const june = stats.find((s) => s.period === "June")!;
    expect(june.years).toBeGreaterThanOrEqual(20);
    expect(june.avg20y).not.toBeNull();
  });

  it("never fabricates a month that has zero occurrences in the data", () => {
    // Candles that only ever land in January (an artificial gap).
    const janOnly = buildMultiYearDailyCandles({ years: 3, startYear: 2020, startPrice: 100, monthBiasPctPerDay: () => 0 }).filter(
      (c) => new Date(c.date).getUTCMonth() === 0
    );
    const stats = computeMonthlySeasonality(janOnly);
    expect(stats.every((s) => s.period === "January")).toBe(true);
  });
});

describe("computeWeekdaySeasonality", () => {
  it("returns stats only for actual trading weekdays (Mon-Fri)", () => {
    const candles = buildMultiYearDailyCandles({ years: 3, startYear: 2021, startPrice: 100, monthBiasPctPerDay: () => 0 });
    const stats = computeWeekdaySeasonality(candles);
    expect(stats.map((s) => s.period).sort()).toEqual(["Friday", "Monday", "Thursday", "Tuesday", "Wednesday"].sort());
  });
});

describe("computeCurrentMonthStat", () => {
  it("returns the stat matching the reference date's month", () => {
    const candles = buildMultiYearDailyCandles({ years: 4, startYear: 2019, startPrice: 100, monthBiasPctPerDay: () => 0 });
    const stat = computeCurrentMonthStat(candles, new Date("2026-03-15T00:00:00Z"));
    expect(stat?.period).toBe("March");
  });

  it("returns null when the candle history has no data at all", () => {
    expect(computeCurrentMonthStat([], new Date())).toBeNull();
  });
});

describe("computeHistoricalSampleDepth", () => {
  it("reports the real span and observation count, not a period-occurrence count", () => {
    const candles = buildMultiYearDailyCandles({ years: 5, startYear: 2020, startPrice: 1.25, monthBiasPctPerDay: () => 0.01, seed: 8 });
    const depth = computeHistoricalSampleDepth(candles)!;

    expect(depth).not.toBeNull();
    expect(depth.observations).toBe(candles.length);
    expect(depth.earliestDate).toBe(candles[0].date);
    expect(depth.latestDate).toBe(candles[candles.length - 1].date);
    expect(depth.yearsSpanned).toBeCloseTo(5, 0);
    expect(depth.calendarYears).toBe(5);
  });

  it("computes positive-year percentage and avg/median annual return from whole calendar years only", () => {
    // A steady positive daily bias -> every whole calendar year should close
    // higher than it opened, so positiveYearPct should be 100.
    const candles = buildMultiYearDailyCandles({ years: 4, startYear: 2021, startPrice: 1.0, monthBiasPctPerDay: () => 0.05, seed: 12 });
    const depth = computeHistoricalSampleDepth(candles)!;

    expect(depth.positiveYearPct).toBe(100);
    expect(depth.avgAnnualReturn).toBeGreaterThan(0);
    expect(depth.medianAnnualReturn).toBeGreaterThan(0);
  });

  it("never overstates a thin sample — ~1 year of data reports yearsSpanned near 1, not a larger number", () => {
    const candles = buildMultiYearDailyCandles({ years: 1, startYear: 2025, startPrice: 1.27, monthBiasPctPerDay: () => 0.01, seed: 4 });
    const depth = computeHistoricalSampleDepth(candles)!;

    expect(depth.yearsSpanned).toBeLessThan(1.1);
    expect(depth.yearsSpanned).toBeGreaterThan(0.9);
  });

  it("returns null for an empty or single-candle sample — nothing to measure", () => {
    expect(computeHistoricalSampleDepth([])).toBeNull();
    expect(computeHistoricalSampleDepth([{ date: "2025-01-01T00:00:00.000Z", open: 1, high: 1, low: 1, close: 1, volume: 0 }])).toBeNull();
  });
});
