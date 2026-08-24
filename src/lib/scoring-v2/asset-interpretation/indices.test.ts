import { describe, expect, it } from "vitest";
import { computeIndicesGrowthShock, computeIndicesInflationShock } from "./indices";

describe("computeIndicesGrowthShock", () => {
  it("treats a strong growth surprise as bullish in a Neutral regime — the standard reading", () => {
    expect(computeIndicesGrowthShock(2, "Neutral")).toBeGreaterThan(0);
  });

  it("treats a strong growth surprise as bullish in a RiskOn regime, more so than Neutral", () => {
    const riskOn = computeIndicesGrowthShock(2, "RiskOn");
    const neutral = computeIndicesGrowthShock(2, "Neutral");
    expect(riskOn).toBeGreaterThan(neutral);
  });

  it("flips a strong growth surprise to a headwind in a HawkishTightening regime — the requirement's explicit scenario", () => {
    expect(computeIndicesGrowthShock(2, "HawkishTightening")).toBeLessThan(0);
  });

  it("mutes a growth surprise heavily in a RiskOff regime — the regime itself dominates", () => {
    const riskOff = Math.abs(computeIndicesGrowthShock(2, "RiskOff"));
    const neutral = Math.abs(computeIndicesGrowthShock(2, "Neutral"));
    expect(riskOff).toBeLessThan(neutral);
  });

  it("amplifies a growth surprise in a DovishEasing regime — growth data is extra-welcome when policy is already loosening", () => {
    const dovish = computeIndicesGrowthShock(2, "DovishEasing");
    const neutral = computeIndicesGrowthShock(2, "Neutral");
    expect(dovish).toBeGreaterThan(neutral);
  });
});

describe("computeIndicesInflationShock", () => {
  it("treats a hot inflation surprise as bearish for equities", () => {
    expect(computeIndicesInflationShock(1.5)).toBeLessThan(0);
  });

  it("treats a cool inflation surprise as bullish for equities", () => {
    expect(computeIndicesInflationShock(-1.5)).toBeGreaterThan(0);
  });
});
