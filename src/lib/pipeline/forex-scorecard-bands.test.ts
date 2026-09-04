import { describe, expect, it } from "vitest";
import { bandStrengthDifferential, bandRateDifferential, bandSurpriseDifferential, synthesizeForexNarrative } from "./forex-scorecard";

describe("bandStrengthDifferential", () => {
  it("bands using 15/45 thresholds", () => {
    expect(bandStrengthDifferential(60)).toBe("Strong bullish");
    expect(bandStrengthDifferential(20)).toBe("Bullish");
    expect(bandStrengthDifferential(0)).toBe("Neutral");
    expect(bandStrengthDifferential(-20)).toBe("Bearish");
    expect(bandStrengthDifferential(-60)).toBe("Strong bearish");
    expect(bandStrengthDifferential(null)).toBeNull();
  });
});

describe("bandRateDifferential", () => {
  it("bands using 0.75/2.5pt thresholds", () => {
    expect(bandRateDifferential(2.91)).toBe("Strong bullish"); // matches the GBP/JPY example
    expect(bandRateDifferential(1)).toBe("Bullish");
    expect(bandRateDifferential(0.1)).toBe("Neutral");
    expect(bandRateDifferential(-1)).toBe("Bearish");
    expect(bandRateDifferential(-3)).toBe("Strong bearish");
    expect(bandRateDifferential(null)).toBeNull();
  });
});

describe("bandSurpriseDifferential", () => {
  it("reuses the shared -10..10 scale banding", () => {
    expect(bandSurpriseDifferential(5)).toBe("Strong bullish");
    expect(bandSurpriseDifferential(-5)).toBe("Strong bearish");
    expect(bandSurpriseDifferential(null)).toBeNull();
  });
});

describe("synthesizeForexNarrative", () => {
  it("combines rate, growth, strength, and trend clauses deterministically", () => {
    const result = synthesizeForexNarrative({ base: "GBP", quote: "JPY", strengthDifferential: 60, rateDifferentialPts: 2.91, growthDifferential: 0, dailyTrend: "Bullish" });
    expect(result).toBe("GBP currently has stronger rate support than JPY, while recent growth data is mixed, and GBP currently has stronger overall macro conditions, and the daily technical trend is bullish.");
  });

  it("returns null when both strength and rate are unavailable", () => {
    expect(synthesizeForexNarrative({ base: "GBP", quote: "JPY", strengthDifferential: null, rateDifferentialPts: null, growthDifferential: null, dailyTrend: null })).toBeNull();
  });

  it("still produces a sentence from strength alone", () => {
    const result = synthesizeForexNarrative({ base: "EUR", quote: "USD", strengthDifferential: -30, rateDifferentialPts: null, growthDifferential: null, dailyTrend: null });
    expect(result).toBe("USD currently has stronger overall macro conditions.");
  });

  it("never claims a side is stronger when the differential is exactly 0", () => {
    const result = synthesizeForexNarrative({ base: "EUR", quote: "USD", strengthDifferential: 0, rateDifferentialPts: null, growthDifferential: null, dailyTrend: null });
    expect(result).toBe("EUR and USD have similar overall macro conditions.");
  });

  it("names the favored side for a real, non-neutral growth differential", () => {
    const result = synthesizeForexNarrative({ base: "USD", quote: "JPY", strengthDifferential: 10, rateDifferentialPts: null, growthDifferential: 5, dailyTrend: null });
    expect(result).toBe("recent growth data favors USD, while USD currently has stronger overall macro conditions.");
  });
});
