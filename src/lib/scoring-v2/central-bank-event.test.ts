import { describe, expect, it } from "vitest";
import { computeCentralBankEvent, computeForwardGuidanceShock, computeRateDecisionShock } from "./central-bank-event";

describe("computeRateDecisionShock", () => {
  it("produces a positive shock for a hawkish surprise (actual rate higher than expected)", () => {
    expect(computeRateDecisionShock(5.5, 5.25)).toBeGreaterThan(0);
  });

  it("produces a negative shock for a dovish surprise (actual rate lower than expected)", () => {
    expect(computeRateDecisionShock(5.0, 5.25)).toBeLessThan(0);
  });

  it("produces zero shock for a decision that exactly matched expectations", () => {
    expect(computeRateDecisionShock(5.25, 5.25)).toBe(0);
  });

  it("clamps an extreme rate surprise to the shared -10..10 range", () => {
    expect(computeRateDecisionShock(15, 0)).toBeLessThanOrEqual(10);
  });
});

describe("computeForwardGuidanceShock — reusing real news-pipeline signals as an honest guidance proxy", () => {
  it("returns 0 with no relevant news coverage this cycle — a legitimate 'no shock' state, not a gap", () => {
    expect(computeForwardGuidanceShock([])).toBe(0);
  });

  it("produces a positive shock when tagged coverage skews Bullish (dovish-for-risk-assets guidance)", () => {
    const shock = computeForwardGuidanceShock([
      { interpretation: "Bullish", importance: 90, confidence: 85 },
      { interpretation: "Bullish", importance: 70, confidence: 80 },
    ]);
    expect(shock).toBeGreaterThan(0);
  });

  it("produces a negative shock when tagged coverage skews Bearish", () => {
    const shock = computeForwardGuidanceShock([{ interpretation: "Bearish", importance: 90, confidence: 85 }]);
    expect(shock).toBeLessThan(0);
  });

  it("weighs higher-importance, higher-confidence coverage more heavily than low-quality coverage", () => {
    const strongBullish = computeForwardGuidanceShock([
      { interpretation: "Bullish", importance: 95, confidence: 95 },
      { interpretation: "Bearish", importance: 10, confidence: 10 },
    ]);
    expect(strongBullish).toBeGreaterThan(0);
  });

  it("nets Mixed/Neutral/Unclear coverage toward zero", () => {
    expect(computeForwardGuidanceShock([{ interpretation: "Mixed", importance: 80, confidence: 80 }])).toBe(0);
  });
});

describe("computeCentralBankEvent", () => {
  it("keeps rate decision shock and forward guidance shock as two separate, independently attributable numbers", () => {
    const result = computeCentralBankEvent(5.0, 5.25, [{ interpretation: "Bullish", importance: 80, confidence: 80 }]);
    expect(result.rateDecisionShock).toBeLessThan(0); // dovish decision
    expect(result.forwardGuidanceShock).toBeGreaterThan(0); // but dovish/bullish-for-risk guidance
  });

  it("handles an unchanged rate with unexpectedly dovish guidance still producing a real shock — the exact scenario the requirement calls out", () => {
    const result = computeCentralBankEvent(5.25, 5.25, [{ interpretation: "Bullish", importance: 95, confidence: 90 }]);
    expect(result.rateDecisionShock).toBe(0); // no rate surprise at all
    expect(result.forwardGuidanceShock).toBeGreaterThan(0); // but guidance still moves the needle
  });

  it("returns a zero rate-decision shock when no policy-rate data is available, without throwing", () => {
    const result = computeCentralBankEvent(null, null, []);
    expect(result.rateDecisionShock).toBe(0);
    expect(result.forwardGuidanceShock).toBe(0);
  });
});
