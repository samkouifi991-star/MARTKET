import { describe, expect, it } from "vitest";
import { applySurprise, computeCountryMacroScores, computeFxDifferential, scoreIndicator } from "./macro-differential";
import { FredSeriesPoint } from "@/services/types";

function series(values: number[]): FredSeriesPoint[] {
  return values.map((value, i) => ({ date: `2025-${String(i + 1).padStart(2, "0")}-01`, value }));
}

describe("scoreIndicator", () => {
  it("returns null with fewer than 3 observations", () => {
    expect(scoreIndicator("cpi", series([3.1, 3.2]))).toBeNull();
  });

  it("scores rising CPI as positive (higher-is-better indicator, by this project's polarity convention)", () => {
    const result = scoreIndicator("cpi", series([2.0, 2.2, 2.4, 2.9]))!;
    expect(result.trend).toBe("Improving");
    expect(result.rawScore).toBeGreaterThan(0);
  });

  it("scores a rising unemployment rate as negative (lower-is-better indicator)", () => {
    const result = scoreIndicator("unemploymentRate", series([3.8, 3.9, 4.0, 4.4]))!;
    expect(result.trend).toBe("Deteriorating");
    expect(result.rawScore).toBeLessThan(0);
  });

  it("detects acceleration when the move is getting bigger in the same direction", () => {
    const result = scoreIndicator("payrolls", series([1000, 1010, 1025, 1060]))!; // +10, +15, +35 -> accelerating
    expect(result.acceleration).toBe("Accelerating");
  });

  it("detects deceleration when the move is shrinking in the same direction", () => {
    const result = scoreIndicator("payrolls", series([1000, 1060, 1085, 1090]))!; // +60, +25, +5 -> decelerating
    expect(result.acceleration).toBe("Decelerating");
  });

  it("marks a near-flat move as Stable rather than forcing a direction", () => {
    const result = scoreIndicator("retailSales", series([100, 100.4, 99.8, 100.1, 100.05]))!;
    expect(result.trend).toBe("Stable");
  });
});

describe("applySurprise", () => {
  it("nudges the score up on a positive beat for a higher-is-better indicator", () => {
    const base = scoreIndicator("cpi", series([2.0, 2.1, 2.2, 2.2]))!;
    const withSurprise = applySurprise(base, 2.5, 2.2); // actual beat forecast
    expect(withSurprise.rawScore).toBeGreaterThanOrEqual(base.rawScore);
    expect(withSurprise.surpriseAdjustment).toBeGreaterThan(0);
  });
});

describe("computeCountryMacroScores", () => {
  it("averages indicators within each category and leaves missing categories null", () => {
    const result = computeCountryMacroScores({
      cpi: series([2.0, 2.2, 2.4, 2.9]),
      coreCpi: series([2.0, 2.1, 2.2, 2.3]),
      unemploymentRate: series([4.0, 4.0, 3.9, 3.8]),
    });
    expect(result.inflationScore).not.toBeNull();
    expect(result.laborScore).not.toBeNull();
    expect(result.growthScore).toBeNull(); // no growth-category series supplied
    expect(result.indicators).toHaveLength(3);
  });
});

describe("computeFxDifferential", () => {
  it("is positive when the base economy is stronger", () => {
    expect(computeFxDifferential(5, -2)).toBeGreaterThan(0);
  });

  it("is negative when the quote economy is stronger", () => {
    expect(computeFxDifferential(-1, 6)).toBeLessThan(0);
  });

  it("is null when either side is missing data", () => {
    expect(computeFxDifferential(null, 4)).toBeNull();
    expect(computeFxDifferential(4, null)).toBeNull();
  });
});
