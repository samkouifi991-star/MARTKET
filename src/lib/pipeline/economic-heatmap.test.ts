import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./macro", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./macro")>();
  return { ...actual, fetchCountryScores: vi.fn(), fetchLatestRates: vi.fn() };
});
vi.mock("@/db/queries/economic-releases");

import { fetchCountryScores, fetchLatestRates } from "./macro";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";
import { buildEconomicHeatmap, bandHeatmapValue, HEATMAP_FACTORS } from "./economic-heatmap";

describe("bandHeatmapValue", () => {
  it("bands into the 5 expected tiers", () => {
    expect(bandHeatmapValue(7)).toBe("Strong bullish");
    expect(bandHeatmapValue(2)).toBe("Bullish");
    expect(bandHeatmapValue(0)).toBe("Neutral");
    expect(bandHeatmapValue(-2)).toBe("Bearish");
    expect(bandHeatmapValue(-7)).toBe("Strong bearish");
  });
});

describe("buildEconomicHeatmap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns one row per factor and one cell per tracked currency", async () => {
    vi.mocked(fetchCountryScores).mockResolvedValue({ growthScore: 2, inflationScore: -1, laborScore: 3, indicators: [], freshness: "live" });
    vi.mocked(fetchLatestRates).mockResolvedValue({ policyRate: 4, trend: 0, freshness: "live" });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);

    const data = await buildEconomicHeatmap(true);
    expect(data.rows.map((r) => r.factor)).toEqual([...HEATMAP_FACTORS]);
    expect(data.currencies.length).toBe(8);
    for (const row of data.rows) {
      expect(Object.keys(row.cells).sort()).toEqual([...data.currencies].sort());
    }
  });

  it("bands the Growth row from real macro scores", async () => {
    vi.mocked(fetchCountryScores).mockImplementation(async () => ({ growthScore: 8, inflationScore: null, laborScore: null, indicators: [], freshness: "live" }));
    vi.mocked(fetchLatestRates).mockResolvedValue({ policyRate: null, trend: 0, freshness: "unavailable" });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);

    const data = await buildEconomicHeatmap(true);
    const growthRow = data.rows.find((r) => r.factor === "Growth")!;
    expect(growthRow.cells["USD"].label).toBe("Strong bullish");
    const inflationRow = data.rows.find((r) => r.factor === "Inflation")!;
    expect(inflationRow.cells["USD"].value).toBeNull();
  });

  it("null policy rate produces a null Rates cell", async () => {
    vi.mocked(fetchCountryScores).mockResolvedValue({ growthScore: null, inflationScore: null, laborScore: null, indicators: [], freshness: null });
    vi.mocked(fetchLatestRates).mockResolvedValue({ policyRate: null, trend: 0, freshness: "unavailable" });
    vi.mocked(getRecentSurprisesForCountries).mockResolvedValue([]);

    const data = await buildEconomicHeatmap(true);
    const ratesRow = data.rows.find((r) => r.factor === "Rates")!;
    expect(ratesRow.cells["USD"].value).toBeNull();
  });
});
