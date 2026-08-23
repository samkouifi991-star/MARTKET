import { describe, expect, it } from "vitest";
import { applyFamilyCaps, FamilyContribution } from "./factor-families";

describe("applyFamilyCaps", () => {
  it("leaves a family's contributions untouched when their sum is within the cap", () => {
    const contributions: FamilyContribution[] = [
      { key: "economicGrowth", contribution: 1 },
      { key: "inflation", contribution: 1.5 },
    ];
    const result = applyFamilyCaps(contributions, [{ family: "Macro", maxContribution: 6 }]);
    expect(result).toEqual(contributions);
  });

  it("scales down every member of an over-cap family proportionally, preserving their relative weight", () => {
    // Macro family: growth +3, inflation +3, labor +3, rates +3 = +12, all pointing the same
    // direction — exactly the "one macro story counted 5 times" scenario requirement #11 targets.
    const contributions: FamilyContribution[] = [
      { key: "economicGrowth", contribution: 3 },
      { key: "inflation", contribution: 3 },
      { key: "labor", contribution: 3 },
      { key: "interestRates", contribution: 3 },
    ];
    const result = applyFamilyCaps(contributions, [{ family: "Macro", maxContribution: 6 }]);
    const total = result.reduce((s, c) => s + c.contribution, 0);
    expect(total).toBeCloseTo(6, 4);
    // Every member was scaled by the same factor (0.5), so they stay equal to each other.
    for (const c of result) expect(c.contribution).toBeCloseTo(1.5, 4);
  });

  it("preserves sign when capping a negative-total family", () => {
    const contributions: FamilyContribution[] = [
      { key: "economicGrowth", contribution: -4 },
      { key: "inflation", contribution: -4 },
    ];
    const result = applyFamilyCaps(contributions, [{ family: "Macro", maxContribution: 6 }]);
    const total = result.reduce((s, c) => s + c.contribution, 0);
    expect(total).toBeCloseTo(-6, 4);
  });

  it("keeps different families independent — capping Macro never touches Technical", () => {
    const contributions: FamilyContribution[] = [
      { key: "economicGrowth", contribution: 5 },
      { key: "inflation", contribution: 5 },
      { key: "technical", contribution: 2 },
    ];
    const result = applyFamilyCaps(contributions, [
      { family: "Macro", maxContribution: 6 },
      { family: "Technical", maxContribution: 4 },
    ]);
    const technical = result.find((c) => c.key === "technical");
    expect(technical?.contribution).toBe(2);
  });

  it("passes through a family with no configured cap unchanged", () => {
    const contributions: FamilyContribution[] = [{ key: "technical", contribution: 8 }];
    const result = applyFamilyCaps(contributions, [{ family: "Macro", maxContribution: 6 }]);
    expect(result).toEqual(contributions);
  });

  it("routes the V2-only 'event' pseudo-key into the Event family", () => {
    const contributions: FamilyContribution[] = [{ key: "event", contribution: 5 }];
    const result = applyFamilyCaps(contributions, [{ family: "Event", maxContribution: 3 }]);
    expect(result[0].contribution).toBeCloseTo(3, 4);
  });
});
