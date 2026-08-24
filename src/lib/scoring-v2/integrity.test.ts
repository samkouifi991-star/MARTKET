import { describe, expect, it } from "vitest";
import { validateScoreIntegrity } from "./integrity";
import { ScoreFactor } from "@/lib/types";

function factor(overrides: Partial<ScoreFactor> = {}): ScoreFactor {
  return {
    key: "technical",
    contribution: 1,
    rawScore: 5,
    weight: 0.2,
    explanation: "test",
    source: "Test source",
    provider: "test",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
    ...overrides,
  };
}

describe("validateScoreIntegrity", () => {
  it("passes a well-formed score whose total equals the sum of contributions", () => {
    const factors = [factor({ key: "technical", contribution: 1 }), factor({ key: "seasonality", contribution: 0.5 })];
    const result = validateScoreIntegrity({ totalScore: 1.5, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(true);
  });

  it("rejects a total that doesn't match the sum of visible contributions", () => {
    const factors = [factor({ contribution: 1 }), factor({ key: "seasonality", contribution: 0.5 })];
    const result = validateScoreIntegrity({ totalScore: 5, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("does not equal the sum"))).toBe(true);
  });

  it("rejects NaN totalScore or confidence", () => {
    const factors = [factor()];
    expect(validateScoreIntegrity({ totalScore: NaN, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false }).valid).toBe(false);
    expect(validateScoreIntegrity({ totalScore: 1, factors, confidence: NaN, scoringVersionId: 1, bootstrapConfigAllowed: false }).valid).toBe(false);
  });

  it("rejects a score outside [-10, 10]", () => {
    const factors = [factor({ contribution: 11 })];
    const result = validateScoreIntegrity({ totalScore: 11, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
  });

  it("rejects an unavailable factor that still contributes a non-zero amount", () => {
    const factors = [factor({ freshness: "unavailable", contribution: 2, rawScore: 0 })];
    const result = validateScoreIntegrity({ totalScore: 2, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes("unavailable"))).toBe(true);
  });

  it("accepts an unavailable factor that correctly contributes exactly 0", () => {
    const factors = [factor({ freshness: "unavailable", contribution: 0, rawScore: 0 }), factor({ key: "seasonality", contribution: 1 })];
    const result = validateScoreIntegrity({ totalScore: 1, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(true);
  });

  it("rejects a factor missing provenance/timestamps", () => {
    const factors = [factor({ source: "" })];
    const result = validateScoreIntegrity({ totalScore: 1, factors, confidence: 80, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
  });

  it("rejects an unresolvable config version (null) when bootstrap defaults aren't explicitly allowed", () => {
    const factors = [factor()];
    const result = validateScoreIntegrity({ totalScore: 1, factors, confidence: 80, scoringVersionId: null, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
  });

  it("accepts a null config version when bootstrap defaults are explicitly marked allowed", () => {
    const factors = [factor()];
    const result = validateScoreIntegrity({ totalScore: 1, factors, confidence: 80, scoringVersionId: null, bootstrapConfigAllowed: true });
    expect(result.valid).toBe(true);
  });

  it("rejects an empty factor list", () => {
    const result = validateScoreIntegrity({ totalScore: 0, factors: [], confidence: 50, scoringVersionId: 1, bootstrapConfigAllowed: false });
    expect(result.valid).toBe(false);
  });
});
