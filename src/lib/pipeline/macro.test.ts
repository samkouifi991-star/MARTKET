import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/fred");
vi.mock("@/db/queries/market-data");

import * as fred from "@/services/market-data/fred";
import { getLatestStoredEconomicSeries } from "@/db/queries/market-data";
import { resolveInflationFactor } from "./macro";

function liveSeries(value: number): Awaited<ReturnType<typeof fred.getSeries>> {
  return {
    provider: "fred",
    source: "FRED",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: [
      { date: "2024-01-01", value: value - 1 },
      { date: "2024-02-01", value: value - 0.5 },
      { date: "2024-03-01", value: value },
    ],
  };
}

function staleSeries(value: number): Awaited<ReturnType<typeof fred.getSeries>> {
  const s = liveSeries(value);
  return { ...s, status: "stale", error: "Latest observation is old" };
}

describe("resolveInflationFactor freshness propagation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No stored fallback in these tests — every scenario here exercises the
    // live path (live or a real "stale" live result, never a genuine fetch
    // failure), so getFredSeriesWithFallback should never even reach a DB
    // read; this just keeps it from throwing if it somehow did.
    vi.mocked(getLatestStoredEconomicSeries).mockResolvedValue(null);
  });

  it("marks the factor live when every contributing FRED series is live", async () => {
    vi.mocked(fred.getSeries).mockImplementation(async (country: string, indicator: string) => {
      if (indicator === "cpi") return liveSeries(country === "GB" ? 130 : 300);
      if (indicator === "coreCpi") return liveSeries(country === "GB" ? 128 : 295);
      return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    });

    const factor = await resolveInflationFactor("GBPUSD", "live");

    expect(factor.freshness).toBe("live");
  });

  it("downgrades the factor to stale — not live — when a contributing series (e.g. GB CPI) is stale, instead of pretending it's current", async () => {
    vi.mocked(fred.getSeries).mockImplementation(async (country: string, indicator: string) => {
      if (indicator === "cpi" && country === "GB") return staleSeries(130); // the real-world GB CPI case
      if (indicator === "cpi") return liveSeries(300);
      if (indicator === "coreCpi") return liveSeries(country === "GB" ? 128 : 295);
      return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    });

    const factor = await resolveInflationFactor("GBPUSD", "live");

    // Still contributes real data (the stale series wasn't excluded from
    // the average, just downgraded) — freshness must reflect it, though.
    expect(factor.freshness).toBe("stale");
    expect(factor.explanation).toMatch(/stale/i);
  });
});
