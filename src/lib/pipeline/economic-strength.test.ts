import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./macro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./macro")>();
  return { ...actual, fetchCountryScores: vi.fn(), fetchLatestRates: vi.fn() };
});
vi.mock("@/db/queries/economic-releases");

import { fetchCountryScores, fetchLatestRates } from "./macro";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";
import { computeAllCurrencyStrengths, computeCurrencyStrength } from "./economic-strength";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"];

function mockUniform(growthScore: number | null, laborScore: number | null, policyRate: number | null) {
  vi.mocked(fetchCountryScores).mockResolvedValue({ growthScore, laborScore, inflationScore: null, indicators: [], freshness: growthScore !== null || laborScore !== null ? "live" : null });
  vi.mocked(fetchLatestRates).mockResolvedValue({ policyRate, trend: 0, freshness: policyRate !== null ? "live" : "unavailable" });
  vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);
}

describe("computeAllCurrencyStrengths", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns one entry per tracked currency", async () => {
    mockUniform(2, 1, 4);
    const all = await computeAllCurrencyStrengths(true);
    expect(all.map((c) => c.currency).sort()).toEqual([...CURRENCIES].sort());
  });

  it("returns null score with freshness unavailable when a currency has no data at all", async () => {
    vi.mocked(fetchCountryScores).mockResolvedValue({ growthScore: null, laborScore: null, inflationScore: null, indicators: [], freshness: null });
    vi.mocked(fetchLatestRates).mockResolvedValue({ policyRate: null, trend: 0, freshness: "unavailable" });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);
    const all = await computeAllCurrencyStrengths(true);
    for (const c of all) {
      expect(c.score).toBeNull();
      expect(c.level).toBeNull();
      expect(c.freshness).toBe("unavailable");
      expect(c.drivers).toEqual([]);
    }
  });

  it("gives a positive score to a currency with strong growth/labor and an above-average rate", async () => {
    // All 8 currencies uniform except USD, which fetchCountryScores/fetchLatestRates
    // return per-call in the same order requested — mockImplementation lets us
    // differentiate USD (first call, index 0 given CCY_TO_COUNTRY's key order) from the rest.
    let call = 0;
    vi.mocked(fetchCountryScores).mockImplementation(async () => {
      const isFirst = call++ === 0;
      return { growthScore: isFirst ? 8 : 0, laborScore: isFirst ? 7 : 0, inflationScore: null, indicators: [], freshness: "live" };
    });
    let rateCall = 0;
    vi.mocked(fetchLatestRates).mockImplementation(async () => {
      const isFirst = rateCall++ === 0;
      return { policyRate: isFirst ? 8 : 2, trend: 0, freshness: "live" };
    });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);

    const all = await computeAllCurrencyStrengths(true);
    const usd = all.find((c) => c.currency === "USD")!;
    const eur = all.find((c) => c.currency === "EUR")!;
    expect(usd.score).not.toBeNull();
    expect(eur.score).not.toBeNull();
    expect(usd.score!).toBeGreaterThan(eur.score!);
    expect(usd.level).toBe("Very Strong");
  });

  it("weights recent surprises by importance tier", async () => {
    mockUniform(0, 0, 4);
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([
      { id: 1, indicatorKey: "cpi", country: "US", actual: 0.4, forecast: 0.2, surpriseZ: 2, importanceTier: "HIGH", releaseDateTime: "2027-01-15T13:30:00.000Z" },
    ]);
    const all = await computeAllCurrencyStrengths(true);
    const usd = all.find((c) => c.currency === "USD")!;
    expect(usd.drivers.some((d) => d.label === "Recent economic surprises" && d.contribution > 0)).toBe(true);
  });
});

describe("computeCurrencyStrength", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockUniform(1, 1, 3);
  });

  it("returns the single requested currency", async () => {
    const usd = await computeCurrencyStrength("USD", true);
    expect(usd.currency).toBe("USD");
  });

  it("throws for an untracked currency", async () => {
    await expect(computeCurrencyStrength("XXX", true)).rejects.toThrow(/not one of the tracked currencies/);
  });
});
