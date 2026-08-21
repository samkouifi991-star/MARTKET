import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/fred");
vi.mock("@/db/queries/market-data");

import * as fred from "@/services/market-data/fred";
import { getLatestStoredEconomicSeries } from "@/db/queries/market-data";
import { resolveInflationFactor, resolveEconomicGrowthFactor, resolveInterestRatesFactor } from "./macro";

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

describe("resolveEconomicGrowthFactor — primary local macro model vs. proxy, per instrument", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLatestStoredEconomicSeries).mockResolvedValue(null);
  });

  function mockCountryLive(expectedCountry: string, value: number) {
    vi.mocked(fred.getSeries).mockImplementation(async (country: string, indicator: string) => {
      if (country !== expectedCountry) return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
      if (indicator === "realGdp" || indicator === "gdpGrowth") return liveSeries(value);
      return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    });
  }

  it("uses GB data as FTSE100's primary local macro profile, not a US proxy", async () => {
    mockCountryLive("GB", 2.5);

    const factor = await resolveEconomicGrowthFactor("FTSE100", "live");

    expect(factor.explanation).toMatch(/GB.*primary local macro profile/);
    expect(factor.explanation).not.toMatch(/risk-appetite proxy/i);
    expect(factor.rawScore).not.toBe(0);
  });

  it("uses JP data as NIKKEI225's primary local macro profile, not a US proxy", async () => {
    mockCountryLive("JP", 1.2);

    const factor = await resolveEconomicGrowthFactor("NIKKEI225", "live");

    expect(factor.explanation).toMatch(/JP.*primary local macro profile/);
    expect(factor.explanation).not.toMatch(/risk-appetite proxy/i);
  });

  it("uses US data as RUT2000/SPX500's primary local macro profile too — they're genuinely US indices, not a proxy standing in for something else", async () => {
    mockCountryLive("US", 3.0);

    const factor = await resolveEconomicGrowthFactor("RUT2000", "live");

    expect(factor.explanation).toMatch(/US.*primary local macro profile/);
  });

  it("labels ETHUSD's US macro input as an explicit Global Liquidity Macro Proxy, not a country model", async () => {
    mockCountryLive("US", 3.0);

    const factor = await resolveEconomicGrowthFactor("ETHUSD", "live");

    expect(factor.explanation).toMatch(/US \/ Global Liquidity Macro Proxy/);
    expect(factor.explanation).not.toMatch(/primary local macro profile/);
  });

  it("keeps the generic risk-appetite-proxy wording for commodities (no single home-market economy)", async () => {
    mockCountryLive("US", 3.0);

    const factor = await resolveEconomicGrowthFactor("XAUUSD", "live");

    expect(factor.explanation).toMatch(/risk-appetite proxy/i);
    expect(factor.explanation).not.toMatch(/primary local macro profile|Global Liquidity/);
  });
});

describe("resolveInterestRatesFactor — same primary-local-model-vs-proxy split for policy rates", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getLatestStoredEconomicSeries).mockResolvedValue(null);
  });

  it("uses the Bank of England rate for FTSE100, not the Fed rate", async () => {
    vi.mocked(fred.getSeries).mockImplementation(async (country: string, indicator: string) => {
      if (country === "GB" && indicator === "policyRate") return liveSeries(5.0);
      return { provider: "fred", source: "FRED", status: "unavailable", fetchedAt: "", sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
    });

    const factor = await resolveInterestRatesFactor("FTSE100", "live");

    expect(factor.explanation).toMatch(/GB policy rate/);
    expect(factor.explanation).toMatch(/primary local rate environment/);
  });
});
