import { describe, expect, it } from "vitest";
import { computeFxRelativeSurpriseShock, computeFxRelativeSurpriseShockOneSided } from "./fx";

describe("computeFxRelativeSurpriseShock — the GBPUSD example from the spec", () => {
  it("is bullish for the base currency when the base country's surprise beats the quote country's", () => {
    // Strong UK payrolls (base=GBP) vs a flat US read -> bullish GBPUSD.
    expect(computeFxRelativeSurpriseShock(2.0, 0)).toBeGreaterThan(0);
  });

  it("is bearish for the base currency when the quote country's surprise beats the base country's — strong US payrolls can be bearish GBPUSD", () => {
    expect(computeFxRelativeSurpriseShock(0, 2.0)).toBeLessThan(0);
  });

  it("nets to (near) zero when both countries surprise by the same amount in the same direction — no relative edge", () => {
    expect(computeFxRelativeSurpriseShock(1.5, 1.5)).toBe(0);
  });

  it("clamps an extreme differential to the shared -10..10 range", () => {
    expect(computeFxRelativeSurpriseShock(10, -10)).toBeLessThanOrEqual(10);
  });
});

describe("computeFxRelativeSurpriseShockOneSided", () => {
  it("treats a base-country surprise as directly bullish for the base currency", () => {
    expect(computeFxRelativeSurpriseShockOneSided(2, true)).toBeGreaterThan(0);
  });

  it("treats a quote-country surprise as bearish for the base currency (bullish for the quote)", () => {
    expect(computeFxRelativeSurpriseShockOneSided(2, false)).toBeLessThan(0);
  });

  it("matches the two-sided function when the untouched side is implicitly zero", () => {
    expect(computeFxRelativeSurpriseShockOneSided(2, true)).toBe(computeFxRelativeSurpriseShock(2, 0));
    expect(computeFxRelativeSurpriseShockOneSided(2, false)).toBe(computeFxRelativeSurpriseShock(0, 2));
  });
});
