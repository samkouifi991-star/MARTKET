import { describe, expect, it } from "vitest";
import { computeCryptoGrowthLaborShock, computeCryptoRegimeShock } from "./crypto";

describe("computeCryptoRegimeShock", () => {
  it("is strongly bullish in a dovish-easing regime — loosening liquidity", () => {
    expect(computeCryptoRegimeShock("DovishEasing")).toBeGreaterThan(0);
  });

  it("is strongly bearish in a hawkish-tightening regime", () => {
    expect(computeCryptoRegimeShock("HawkishTightening")).toBeLessThan(0);
  });

  it("is moderately positive in risk-on and moderately negative in risk-off, smaller in magnitude than the rate-regime reads", () => {
    expect(computeCryptoRegimeShock("RiskOn")).toBeGreaterThan(0);
    expect(computeCryptoRegimeShock("RiskOff")).toBeLessThan(0);
    expect(Math.abs(computeCryptoRegimeShock("RiskOn"))).toBeLessThan(Math.abs(computeCryptoRegimeShock("DovishEasing")));
  });

  it("is neutral (0) with no clear regime", () => {
    expect(computeCryptoRegimeShock("Neutral")).toBe(0);
  });
});

describe("computeCryptoGrowthLaborShock", () => {
  it("produces a real but deliberately small direct contribution from a growth/labor surprise", () => {
    const shock = computeCryptoGrowthLaborShock(2);
    expect(shock).toBeGreaterThan(0);
    expect(Math.abs(shock)).toBeLessThan(1); // small relative to the regime shock's typical magnitude (~2)
  });
});
