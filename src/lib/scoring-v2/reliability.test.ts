import { describe, expect, it } from "vitest";
import { reliabilityMultiplier } from "./reliability";

describe("reliabilityMultiplier", () => {
  it("returns the neutral 1.0 multiplier when there is no data at all (the current, real state of this codebase)", () => {
    expect(reliabilityMultiplier(null)).toBe(1.0);
  });

  it("returns the neutral 1.0 multiplier when the sample size is below the minimum, regardless of hit rate", () => {
    expect(reliabilityMultiplier({ sampleSize: 5, hitRate: 0.95 })).toBe(1.0);
  });

  it("nudges the multiplier above 1.0 for a real, sufficiently-sampled, above-coin-flip hit rate", () => {
    expect(reliabilityMultiplier({ sampleSize: 100, hitRate: 0.65 })).toBeGreaterThan(1.0);
  });

  it("nudges the multiplier below 1.0 for a real, sufficiently-sampled, below-coin-flip hit rate", () => {
    expect(reliabilityMultiplier({ sampleSize: 100, hitRate: 0.35 })).toBeLessThan(1.0);
  });

  it("returns exactly 1.0 for a coin-flip (50%) hit rate even with ample sample size", () => {
    expect(reliabilityMultiplier({ sampleSize: 500, hitRate: 0.5 })).toBe(1.0);
  });

  it("never moves the multiplier by more than the configured cap, even for a perfect or a perfectly-wrong track record", () => {
    expect(reliabilityMultiplier({ sampleSize: 1000, hitRate: 1.0 })).toBeLessThanOrEqual(1.15);
    expect(reliabilityMultiplier({ sampleSize: 1000, hitRate: 0.0 })).toBeGreaterThanOrEqual(0.85);
  });
});
