import { describe, expect, it } from "vitest";
import { strengthLevelForScore, strengthBadgeClasses, riskLevelBadgeClasses } from "./format";

describe("strengthLevelForScore", () => {
  it("bands the composite -100..100 score into 5 tiers", () => {
    expect(strengthLevelForScore(72)).toBe("Very Strong");
    expect(strengthLevelForScore(60)).toBe("Very Strong");
    expect(strengthLevelForScore(38)).toBe("Strong");
    expect(strengthLevelForScore(20)).toBe("Strong");
    expect(strengthLevelForScore(0)).toBe("Moderate");
    expect(strengthLevelForScore(-19)).toBe("Moderate");
    expect(strengthLevelForScore(-45)).toBe("Weak");
    expect(strengthLevelForScore(-60)).toBe("Very Weak");
    expect(strengthLevelForScore(-72)).toBe("Very Weak");
  });
});

describe("strengthBadgeClasses / riskLevelBadgeClasses", () => {
  it("returns distinct, non-empty classes per tier", () => {
    const strengthLevels = ["Very Strong", "Strong", "Moderate", "Weak", "Very Weak"] as const;
    const seen = new Set(strengthLevels.map(strengthBadgeClasses));
    expect(seen.size).toBe(strengthLevels.length);

    const riskLevels = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
    const seenRisk = new Set(riskLevels.map(riskLevelBadgeClasses));
    expect(seenRisk.size).toBe(riskLevels.length);
  });
});
