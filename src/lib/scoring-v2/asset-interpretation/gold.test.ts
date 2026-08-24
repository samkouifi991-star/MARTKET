import { describe, expect, it } from "vitest";
import { computeGoldSurpriseShock, goldForwardGuidanceShock, goldRateDecisionShock } from "./gold";

describe("computeGoldSurpriseShock", () => {
  it("treats a hot (positive) inflation surprise as initially bullish for gold", () => {
    expect(computeGoldSurpriseShock("cpi", 1.5)).toBeGreaterThan(0);
    expect(computeGoldSurpriseShock("coreCpi", 1.5)).toBeGreaterThan(0);
    expect(computeGoldSurpriseShock("pce", 1.5)).toBeGreaterThan(0);
  });

  it("treats a cold (negative) inflation surprise as initially bearish for gold", () => {
    expect(computeGoldSurpriseShock("cpi", -1.5)).toBeLessThan(0);
  });

  it("treats a strong (positive) growth or labor surprise as mildly bearish for gold — the spec's explicit rule", () => {
    expect(computeGoldSurpriseShock("nfp", 1.5)).toBeLessThan(0);
    expect(computeGoldSurpriseShock("gdp", 1.5)).toBeLessThan(0);
    expect(computeGoldSurpriseShock("retailSales", 1.5)).toBeLessThan(0);
  });

  it("scales growth/labor shocks smaller than inflation shocks for the same surprise magnitude — 'usually MILD bearish'", () => {
    const inflationShock = Math.abs(computeGoldSurpriseShock("cpi", 2)!);
    const growthShock = Math.abs(computeGoldSurpriseShock("nfp", 2)!);
    expect(growthShock).toBeLessThan(inflationShock);
  });

  it("returns null (never a fabricated zero-shock) for an indicator gold's surprise model doesn't react to", () => {
    expect(computeGoldSurpriseShock("housingData", 2)).toBeNull();
    expect(computeGoldSurpriseShock("tradeBalance", 2)).toBeNull();
  });

  it("clamps to the shared -10..10 range on an extreme surprise", () => {
    expect(computeGoldSurpriseShock("cpi", 100)).toBeLessThanOrEqual(10);
  });
});

describe("goldRateDecisionShock", () => {
  it("flips the generic (currency-strength) rate-decision convention: a hawkish surprise is bearish for gold", () => {
    expect(goldRateDecisionShock(2)).toBe(-2); // generic +2 = hawkish surprise -> gold -2
    expect(goldRateDecisionShock(-2)).toBe(2); // generic -2 = dovish surprise -> gold +2
  });
});

describe("goldForwardGuidanceShock", () => {
  it("passes through the generic guidance shock unchanged — dovish guidance is bullish for both risk assets and gold", () => {
    expect(goldForwardGuidanceShock(1.5)).toBe(1.5);
    expect(goldForwardGuidanceShock(-1.5)).toBe(-1.5);
  });
});
