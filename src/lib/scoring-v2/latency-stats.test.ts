import { describe, expect, it } from "vitest";
import { computeLatencyStats, LatencySample } from "./latency-stats";

function sample(indicatorKey: LatencySample["indicatorKey"], scheduledAt: string, detectedOffsetMs: number): LatencySample {
  const firstDetectedAt = new Date(new Date(scheduledAt).getTime() + detectedOffsetMs).toISOString();
  return { indicatorKey, scheduledAt, firstDetectedAt };
}

describe("computeLatencyStats", () => {
  it("computes a real median and P95 for an indicator with enough samples", () => {
    const samples = [
      sample("cpi", "2027-01-01T13:30:00.000Z", 60_000),
      sample("cpi", "2027-02-01T13:30:00.000Z", 120_000),
      sample("cpi", "2027-03-01T13:30:00.000Z", 300_000),
      sample("cpi", "2027-04-01T13:30:00.000Z", 90_000),
    ];
    const stats = computeLatencyStats(samples);
    expect(stats).toHaveLength(1);
    expect(stats[0].indicatorKey).toBe("cpi");
    expect(stats[0].sampleSize).toBe(4);
    expect(stats[0].medianMs).toBeGreaterThan(0);
    expect(stats[0].p95Ms).toBeGreaterThanOrEqual(stats[0].medianMs);
  });

  it("excludes an indicator with too few real samples — never fabricates a stat from noise", () => {
    const samples = [sample("nfp", "2027-01-01T13:30:00.000Z", 60_000), sample("nfp", "2027-02-01T13:30:00.000Z", 90_000)];
    expect(computeLatencyStats(samples)).toEqual([]);
  });

  it("groups independently by indicator", () => {
    const samples = [
      sample("cpi", "2027-01-01T00:00:00.000Z", 60_000),
      sample("cpi", "2027-02-01T00:00:00.000Z", 90_000),
      sample("cpi", "2027-03-01T00:00:00.000Z", 120_000),
      sample("nfp", "2027-01-01T00:00:00.000Z", 300_000),
      sample("nfp", "2027-02-01T00:00:00.000Z", 400_000),
      sample("nfp", "2027-03-01T00:00:00.000Z", 500_000),
    ];
    const stats = computeLatencyStats(samples);
    expect(stats.map((s) => s.indicatorKey).sort()).toEqual(["cpi", "nfp"]);
    const nfp = stats.find((s) => s.indicatorKey === "nfp")!;
    expect(nfp.medianMs).toBeGreaterThan(stats.find((s) => s.indicatorKey === "cpi")!.medianMs);
  });

  it("discards a sample whose detection is somehow before its scheduled time as a data anomaly, not a negative latency", () => {
    const samples = [
      sample("cpi", "2027-01-01T00:00:00.000Z", -60_000),
      sample("cpi", "2027-02-01T00:00:00.000Z", 60_000),
      sample("cpi", "2027-03-01T00:00:00.000Z", 90_000),
    ];
    const stats = computeLatencyStats(samples);
    // Only 2 of the 3 samples are valid — below MIN_SAMPLE_SIZE, so excluded entirely.
    expect(stats).toEqual([]);
  });

  it("sorts by sample size descending", () => {
    const samples = [
      sample("cpi", "2027-01-01T00:00:00.000Z", 60_000),
      sample("cpi", "2027-02-01T00:00:00.000Z", 90_000),
      sample("cpi", "2027-03-01T00:00:00.000Z", 120_000),
      sample("nfp", "2027-01-01T00:00:00.000Z", 60_000),
      sample("nfp", "2027-02-01T00:00:00.000Z", 90_000),
      sample("nfp", "2027-03-01T00:00:00.000Z", 90_000),
      sample("nfp", "2027-04-01T00:00:00.000Z", 90_000),
    ];
    const stats = computeLatencyStats(samples);
    expect(stats[0].indicatorKey).toBe("nfp");
    expect(stats[0].sampleSize).toBe(4);
  });
});
