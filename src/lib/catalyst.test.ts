import { describe, expect, it } from "vitest";
import { buildCatalyst, isNewSetup } from "./catalyst";
import { ScoreFactor } from "./types";

function factor(key: ScoreFactor["key"], contribution: number): ScoreFactor {
  return {
    key,
    contribution,
    rawScore: contribution,
    weight: 0.1,
    explanation: "irrelevant for this test",
    source: "test",
    provider: "test",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}

describe("buildCatalyst", () => {
  it("names the top 1-2 factors by |contribution| with direction", () => {
    const factors = [factor("institutional", 2.1), factor("technical", 1.3), factor("news", 0.1)];
    expect(buildCatalyst(factors)).toBe("Institutional positioning (bullish) + Technical trend (bullish)");
  });

  it("mixes bullish/bearish direction independently per factor", () => {
    const factors = [factor("institutional", -3), factor("technical", 1)];
    expect(buildCatalyst(factors)).toBe("Institutional positioning (bearish) + Technical trend (bullish)");
  });

  it("returns null when no factor clears the minimum contribution", () => {
    const factors = [factor("institutional", 0.05), factor("technical", -0.1)];
    expect(buildCatalyst(factors)).toBeNull();
  });

  it("returns only one factor when just one clears the threshold", () => {
    const factors = [factor("institutional", 2), factor("technical", 0.05)];
    expect(buildCatalyst(factors)).toBe("Institutional positioning (bullish)");
  });
});

describe("isNewSetup", () => {
  it("is true when current bias is directional but 24h-ago bias was Neutral", () => {
    // current 4.5 (Bullish, min 4) - change 3 = previous 1.5 (Neutral)
    expect(isNewSetup({ totalScore: 4.5, change24h: 3 })).toBe(true);
  });

  it("is false when both current and prior are directional (not newly qualifying)", () => {
    // current 6 (Bullish) - change 1 = previous 5 (still Bullish)
    expect(isNewSetup({ totalScore: 6, change24h: 1 })).toBe(false);
  });

  it("is false when current score is itself Neutral", () => {
    expect(isNewSetup({ totalScore: 1, change24h: 5 })).toBe(false);
  });

  it("is false when nothing changed (change24h = 0)", () => {
    expect(isNewSetup({ totalScore: 5, change24h: 0 })).toBe(false);
  });
});
