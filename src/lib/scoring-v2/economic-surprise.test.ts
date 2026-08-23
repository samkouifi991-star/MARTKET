import { describe, expect, it } from "vitest";
import { computeEffectiveSurprise, computeHistoricalDistribution, computeRevisionAdjustment, computeSurprise, computeSurpriseZ, surpriseTier } from "./economic-surprise";

describe("computeSurprise", () => {
  it("computes actual minus forecast", () => {
    expect(computeSurprise(0.3, 0.2)).toBeCloseTo(0.1, 4);
  });

  it("returns null when there is no forecast to compare against", () => {
    expect(computeSurprise(0.3, null)).toBeNull();
  });
});

describe("computeRevisionAdjustment + computeEffectiveSurprise — the payrolls example from the spec", () => {
  it("weakens the effective surprise when the prior period was revised down", () => {
    // +220K actual vs +180K expected = +40K raw surprise, but the prior two
    // months were revised down a combined 100K.
    const surprise = computeSurprise(220, 180)!;
    expect(surprise).toBe(40);

    const revisionAdjustment = computeRevisionAdjustment(500, 400); // previous=500K, revised down to 400K
    expect(revisionAdjustment).toBe(-100);

    const effective = computeEffectiveSurprise(surprise, revisionAdjustment);
    expect(effective).toBe(-60); // the "strongly positive" headline is actually net negative once revisions are counted
  });

  it("strengthens the effective surprise when the prior period was revised UP instead", () => {
    const surprise = computeSurprise(220, 180)!;
    const revisionAdjustment = computeRevisionAdjustment(400, 500); // revised up
    expect(computeEffectiveSurprise(surprise, revisionAdjustment)).toBe(140);
  });

  it("applies no adjustment when there is no revision data at all (honest, never assumed)", () => {
    expect(computeRevisionAdjustment(null, null)).toBe(0);
    expect(computeRevisionAdjustment(500, null)).toBe(0);
  });
});

describe("computeHistoricalDistribution + computeSurpriseZ", () => {
  it("returns null (not a fabricated z-score) when fewer than 4 historical observations exist", () => {
    expect(computeHistoricalDistribution([1, 2])).toBeNull();
  });

  it("computes a real mean/stdDev once enough history exists, and z-scores relative to it", () => {
    const distribution = computeHistoricalDistribution([0, 0, 0, 0, 0]); // mean 0, stdDev 0 (degenerate)
    expect(distribution).not.toBeNull();
    // stdDev is 0 here — z-score is undefined, must return null, not divide by zero.
    expect(computeSurpriseZ(5, distribution)).toBeNull();
  });

  it("z-scores a genuine surprise against a real, varied historical distribution", () => {
    const distribution = computeHistoricalDistribution([-2, -1, 0, 1, 2]); // mean 0, stdDev ~1.414
    const z = computeSurpriseZ(2.83, distribution); // ~2 standard deviations above the mean
    expect(z).toBeCloseTo(2, 1);
  });

  it("clamps an extreme z-score so one bad print can't dominate the composite", () => {
    const distribution = computeHistoricalDistribution([0, 0.1, -0.1, 0.05]); // tiny stdDev
    const z = computeSurpriseZ(1000, distribution);
    expect(z).not.toBeNull();
    expect(Math.abs(z!)).toBeLessThanOrEqual(4);
  });
});

describe("surpriseTier", () => {
  it("classifies per the spec's exact bands", () => {
    expect(surpriseTier(0.3)).toBe("minor");
    expect(surpriseTier(0.7)).toBe("moderate");
    expect(surpriseTier(1.5)).toBe("significant");
    expect(surpriseTier(2.5)).toBe("major");
  });

  it("uses the absolute value — a large negative surprise is still 'major'", () => {
    expect(surpriseTier(-2.5)).toBe("major");
  });
});
