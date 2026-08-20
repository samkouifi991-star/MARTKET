import { describe, expect, it } from "vitest";
import { contributionFor } from "./scoring-engine";
import { ResolvedFactor } from "./types";

function factor(freshness: ResolvedFactor["freshness"], rawScore = 4): ResolvedFactor {
  return { key: "technical", rawScore, explanation: "", source: "", provider: "fmp", freshness, lastUpdated: "", nextUpdate: "" };
}

describe("contributionFor freshness dampening", () => {
  it("applies full weight for live", () => {
    expect(contributionFor(factor("live"), 0.2)).toBe(0.8);
  });

  it("mildly dampens delayed (0.85x) — real data, just not freshly re-fetched, per the last-known-good architecture", () => {
    expect(contributionFor(factor("delayed"), 0.2)).toBe(0.68); // 4 * 0.2 * 0.85
  });

  it("dampens stale harder (0.5x) than delayed", () => {
    expect(contributionFor(factor("stale"), 0.2)).toBe(0.4); // 4 * 0.2 * 0.5
  });

  it("zeroes unavailable and error — no fabricated contribution", () => {
    expect(contributionFor(factor("unavailable"), 0.2)).toBe(0);
    expect(contributionFor(factor("error"), 0.2)).toBe(0);
  });
});
