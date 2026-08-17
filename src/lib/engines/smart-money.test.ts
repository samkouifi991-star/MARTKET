import { describe, expect, it } from "vitest";
import { computeInstitutionalMomentum, detectDivergenceSignal, WeeklyPositioning } from "./smart-money";

function weeksOf(netValues: number[]): WeeklyPositioning[] {
  // netValues[0] is most recent, matching CFTC's newest-first convention.
  return netValues.map((net, i) => ({ reportDate: `2026-0${8 - i}-01`, netPositioning: net }));
}

describe("computeInstitutionalMomentum", () => {
  it("returns null with fewer than 4 weeks of history", () => {
    expect(computeInstitutionalMomentum("Leveraged Funds", weeksOf([100, 90]))).toBeNull();
  });

  it("detects sustained accumulation as a positive, multi-week streak", () => {
    // Net position has risen every week for 4 straight weeks (newest-first).
    const history = weeksOf([50000, 42000, 35000, 28000, 20000, 12000]);
    const result = computeInstitutionalMomentum("Leveraged Funds", history)!;
    expect(result.direction).toBe("Accumulating");
    expect(result.consecutiveWeeks).toBeGreaterThanOrEqual(4);
    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.explanation).toContain("consecutive weeks");
  });

  it("detects sustained distribution as a negative streak", () => {
    const history = weeksOf([10000, 18000, 26000, 34000, 42000, 50000]);
    const result = computeInstitutionalMomentum("Managed Money", history)!;
    expect(result.direction).toBe("Distributing");
    expect(result.rawScore).toBeLessThan(0);
  });

  it("gives a weaker/neutral read when weekly changes flip direction (no streak)", () => {
    const history = weeksOf([20000, 15000, 22000, 14000, 21000]);
    const result = computeInstitutionalMomentum("Asset Manager", history)!;
    expect(result.consecutiveWeeks).toBeLessThanOrEqual(1);
  });

  it("never exceeds the -10..10 range even for an extreme streak", () => {
    const history = weeksOf([200000, 100000, 50000, 20000, 5000, 1000, 0]);
    const result = computeInstitutionalMomentum("Leveraged Funds", history)!;
    expect(result.rawScore).toBeLessThanOrEqual(10);
    expect(result.rawScore).toBeGreaterThanOrEqual(-10);
  });
});

describe("detectDivergenceSignal", () => {
  it("flags Bullish Smart Money Divergence when institutions buy while retail is short", () => {
    const result = detectDivergenceSignal({
      netPositioning: 30000,
      netWeeklyChange: 8000,
      percentile: 60,
      priceChangePct: 0.3,
      retail: { pctLong: 35, pctShort: 65, change7d: -2 },
    });
    expect(result.signal).toBe("Bullish Smart Money Divergence");
  });

  it("flags Bearish Smart Money Divergence when institutions sell while retail is long", () => {
    const result = detectDivergenceSignal({
      netPositioning: -10000,
      netWeeklyChange: -9000,
      percentile: 40,
      priceChangePct: -0.2,
      retail: { pctLong: 62, pctShort: 38, change7d: 3 },
    });
    expect(result.signal).toBe("Bearish Smart Money Divergence");
  });

  it("flags Crowded Institutional Trade from CFTC data alone (no retail source needed)", () => {
    const result = detectDivergenceSignal({
      netPositioning: 50000,
      netWeeklyChange: 1000,
      percentile: 93,
      priceChangePct: -0.4, // price falling despite extreme net-long positioning — unconfirmed
      retail: null,
    });
    expect(result.signal).toBe("Crowded Institutional Trade");
  });

  it("degrades gracefully to None when retail is unavailable and nothing else stands out", () => {
    const result = detectDivergenceSignal({
      netPositioning: 5000,
      netWeeklyChange: 200,
      percentile: 50,
      priceChangePct: 0.1,
      retail: null,
    });
    expect(result.signal).toBe("None");
  });
});
