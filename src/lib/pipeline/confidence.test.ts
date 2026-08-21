import { describe, expect, it } from "vitest";
import { computeConfidence } from "./confidence";
import { ResolvedFactor } from "./types";

function factor(key: ResolvedFactor["key"], freshness: ResolvedFactor["freshness"], rawScore = 5): ResolvedFactor {
  return { key, rawScore, explanation: "", source: "", provider: "fmp", freshness, lastUpdated: "", nextUpdate: "" };
}

describe("computeConfidence — not_applicable exclusion", () => {
  it("does not penalize an asset for a factor that structurally does not apply to it", () => {
    // Same 8 live factors either way; the only difference is whether the
    // 9th slot is a real "unavailable" (data-quality problem) or a
    // structural "not_applicable" (e.g. no CFTC contract for this asset).
    const eightLive = Array.from({ length: 8 }, (_, i) => factor(["technical", "seasonality", "economicGrowth", "inflation", "labor", "interestRates", "news", "institutional"][i] as ResolvedFactor["key"], "live"));

    const withUnavailable = [...eightLive, factor("retailSentiment", "unavailable")];
    const withNotApplicable = [...eightLive, factor("retailSentiment", "not_applicable")];

    const confidenceUnavailable = computeConfidence(withUnavailable);
    const confidenceNotApplicable = computeConfidence(withNotApplicable);

    // not_applicable must score at least as high as a genuine gap — the
    // asset isn't missing anything it was ever going to have.
    expect(confidenceNotApplicable).toBeGreaterThan(confidenceUnavailable);
    // With all 8 applicable factors live, confidence should read as if
    // there were only 8 factors to begin with, not 9 with one penalized.
    expect(confidenceNotApplicable).toBe(computeConfidence(eightLive));
  });

  it("returns 0 when every factor is not_applicable (nothing to evaluate)", () => {
    expect(computeConfidence([factor("retailSentiment", "not_applicable"), factor("institutional", "not_applicable")])).toBe(0);
  });
});
