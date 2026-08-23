import { describe, expect, it } from "vitest";
import { computeConfidenceV2 } from "./confidence-v2";
import { ResolvedFactor } from "@/lib/pipeline/types";
import { RegimeInputs } from "./regime";

function factor(overrides: Partial<ResolvedFactor> = {}): ResolvedFactor {
  return {
    key: "technical",
    rawScore: 5,
    explanation: "test",
    source: "Test",
    provider: "fmp",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
    ...overrides,
  };
}

const NEUTRAL_REGIME_INPUTS: RegimeInputs = { realYieldTrend: 0, usdTrend: 0, vixLevel: 18, vixTrend: 0 };

describe("computeConfidenceV2", () => {
  it("returns 0 when every factor is not_applicable (nothing real to be confident or unconfident about)", () => {
    const result = computeConfidenceV2({ factors: [factor({ freshness: "not_applicable" })], reliabilityMultipliers: [], regime: "Neutral", regimeInputs: NEUTRAL_REGIME_INPUTS });
    expect(result).toBe(0);
  });

  it("scores higher for a fully live, high-quality-provider, agreeing set of factors than a degraded one", () => {
    const strong = computeConfidenceV2({
      factors: [factor({ provider: "fred", freshness: "live", rawScore: 5 }), factor({ key: "seasonality", provider: "fred", freshness: "live", rawScore: 5.2 })],
      reliabilityMultipliers: [1.1, 1.1],
      regime: "HawkishTightening",
      regimeInputs: { realYieldTrend: 1.0, usdTrend: 3.0, vixLevel: 16, vixTrend: 0 }, // strong, unambiguous regime
    });
    const weak = computeConfidenceV2({
      factors: [factor({ provider: "demo", freshness: "stale", rawScore: 5 }), factor({ key: "seasonality", provider: "demo", freshness: "unavailable", rawScore: 0 })],
      reliabilityMultipliers: [0.9, 0.9],
      regime: "Neutral",
      regimeInputs: NEUTRAL_REGIME_INPUTS,
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("penalizes disagreeing factors relative to agreeing ones", () => {
    const agreeing = computeConfidenceV2({
      factors: [factor({ rawScore: 5 }), factor({ key: "seasonality", rawScore: 5.2 })],
      reliabilityMultipliers: [1, 1],
      regime: "Neutral",
      regimeInputs: NEUTRAL_REGIME_INPUTS,
    });
    const disagreeing = computeConfidenceV2({
      factors: [factor({ rawScore: 8 }), factor({ key: "seasonality", rawScore: -8 })],
      reliabilityMultipliers: [1, 1],
      regime: "Neutral",
      regimeInputs: NEUTRAL_REGIME_INPUTS,
    });
    expect(agreeing).toBeGreaterThan(disagreeing);
  });

  it("rewards a higher reliability multiplier average, all else equal", () => {
    const base = { factors: [factor()], regime: "Neutral" as const, regimeInputs: NEUTRAL_REGIME_INPUTS };
    const reliable = computeConfidenceV2({ ...base, reliabilityMultipliers: [1.15] });
    const unreliable = computeConfidenceV2({ ...base, reliabilityMultipliers: [0.85] });
    expect(reliable).toBeGreaterThan(unreliable);
  });

  it("rewards a clearer regime read over an ambiguous Neutral one, all else equal", () => {
    const base = { factors: [factor()], reliabilityMultipliers: [1] };
    const clear = computeConfidenceV2({ ...base, regime: "HawkishTightening", regimeInputs: { realYieldTrend: 1.0, usdTrend: 3.0, vixLevel: 16, vixTrend: 0 } });
    const ambiguous = computeConfidenceV2({ ...base, regime: "Neutral", regimeInputs: NEUTRAL_REGIME_INPUTS });
    expect(clear).toBeGreaterThan(ambiguous);
  });

  it("stays within [5, 97] even at the extremes", () => {
    const min = computeConfidenceV2({ factors: [factor({ freshness: "error", provider: "none", rawScore: 0 })], reliabilityMultipliers: [0.85], regime: "Neutral", regimeInputs: NEUTRAL_REGIME_INPUTS });
    expect(min).toBeGreaterThanOrEqual(5);
    const max = computeConfidenceV2({
      factors: [factor({ provider: "fred", freshness: "live" }), factor({ key: "seasonality", provider: "cftc", freshness: "live" })],
      reliabilityMultipliers: [1.15, 1.15],
      regime: "HawkishTightening",
      regimeInputs: { realYieldTrend: 5, usdTrend: 5, vixLevel: 16, vixTrend: 0 },
    });
    expect(max).toBeLessThanOrEqual(97);
  });
});
