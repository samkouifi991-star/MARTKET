import { describe, expect, it } from "vitest";
import { computeNewsShockContribution, mapRelevanceToTier } from "./news-shock";
import { LlmNewsClassification } from "@/lib/engines/llm-news-classifier";

function classification(overrides: Partial<LlmNewsClassification> = {}): LlmNewsClassification {
  return {
    affectedMarkets: ["EURUSD"],
    interpretation: "Bullish",
    importance: 80,
    confidence: 80,
    geopoliticalRelevance: 70,
    monetaryPolicyRelevance: 20,
    riskSentiment: "RiskOff",
    reason: "test fixture",
    ...overrides,
  };
}

describe("computeNewsShockContribution", () => {
  it("produces a positive contribution for high-importance, high-confidence Bullish news", () => {
    const c = computeNewsShockContribution(classification({ interpretation: "Bullish", importance: 100, confidence: 100 }));
    expect(c).toBeCloseTo(10, 4); // clamped at the shared -10..10 max
  });

  it("produces a negative contribution for Bearish news", () => {
    const c = computeNewsShockContribution(classification({ interpretation: "Bearish", importance: 80, confidence: 80 }));
    expect(c).toBeLessThan(0);
  });

  it("never produces a shock for Neutral/Unclear/Mixed interpretations", () => {
    expect(computeNewsShockContribution(classification({ interpretation: "Neutral" }))).toBe(0);
    expect(computeNewsShockContribution(classification({ interpretation: "Unclear" }))).toBe(0);
    expect(computeNewsShockContribution(classification({ interpretation: "Mixed" }))).toBe(0);
  });

  it("attenuates magnitude for low confidence even at high importance", () => {
    const highConfidence = computeNewsShockContribution(classification({ importance: 90, confidence: 90 }));
    const lowConfidence = computeNewsShockContribution(classification({ importance: 90, confidence: 10 }));
    expect(Math.abs(lowConfidence)).toBeLessThan(Math.abs(highConfidence));
  });
});

describe("mapRelevanceToTier", () => {
  it("maps >=70 relevance to HIGH", () => {
    expect(mapRelevanceToTier(classification({ geopoliticalRelevance: 75, monetaryPolicyRelevance: 0 }))).toBe("HIGH");
  });

  it("maps >=40 relevance to MEDIUM", () => {
    expect(mapRelevanceToTier(classification({ geopoliticalRelevance: 45, monetaryPolicyRelevance: 0 }))).toBe("MEDIUM");
  });

  it("maps low relevance to LOW", () => {
    expect(mapRelevanceToTier(classification({ geopoliticalRelevance: 10, monetaryPolicyRelevance: 5 }))).toBe("LOW");
  });

  it("takes the max of geopolitical and monetary-policy relevance", () => {
    expect(mapRelevanceToTier(classification({ geopoliticalRelevance: 10, monetaryPolicyRelevance: 80 }))).toBe("HIGH");
  });
});
