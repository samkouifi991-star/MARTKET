import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/market-data");

import { getEconomicEventCoverage, getEconomicIndicatorCoverage, EconomicEventCoverageRow, EconomicIndicatorCoverageRow } from "@/db/queries/market-data";
import { buildEconomicCoverage } from "./economic-coverage";

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function findRow(rows: Awaited<ReturnType<typeof buildEconomicCoverage>>, label: string) {
  const row = rows.find((r) => r.label === label);
  if (!row) throw new Error(`no coverage row for ${label}`);
  return row;
}

beforeEach(() => {
  vi.mocked(getEconomicEventCoverage).mockResolvedValue([]);
  vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue([]);
});

describe("buildEconomicCoverage", () => {
  it("reads exactly one batched query per table, never per cell", async () => {
    await buildEconomicCoverage();
    expect(getEconomicEventCoverage).toHaveBeenCalledTimes(1);
    expect(getEconomicIndicatorCoverage).toHaveBeenCalledTimes(1);
  });

  it("marks a cell MISSING when neither the calendar nor FRED has anything for that country — never fabricated", async () => {
    const rows = await buildEconomicCoverage();
    const gdp = findRow(rows, "GDP Growth");
    for (const currency of Object.keys(gdp.cells) as (keyof typeof gdp.cells)[]) {
      expect(gdp.cells[currency]).toEqual({ status: "missing", latestDate: null, source: null });
    }
  });

  it("marks a cell CURRENT from a recent FRED observation", async () => {
    const recent = daysAgo(10);
    const fixture: EconomicIndicatorCoverageRow[] = [{ country: "US", indicator: "cpi", latestDate: recent }];
    vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue(fixture);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "CPI").cells.USD).toEqual({ status: "current", latestDate: recent, source: "fred" });
  });

  it("marks a cell STALE from an old FRED observation (JPY CPI, ~5 years old — the real production case)", async () => {
    const fixture: EconomicIndicatorCoverageRow[] = [{ country: "JP", indicator: "cpi", latestDate: "2021-06-01T00:00:00.000Z" }];
    vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue(fixture);
    const rows = await buildEconomicCoverage();
    const cell = findRow(rows, "CPI").cells.JPY;
    expect(cell.status).toBe("stale");
    expect(cell.source).toBe("fred");
  });

  it("prioritizes a real calendar release over FRED macro-state for the same country/indicator", async () => {
    const recent = daysAgo(5);
    vi.mocked(getEconomicEventCoverage).mockResolvedValue([{ country: "US", indicatorKey: "cpi", latestDate: recent }] satisfies EconomicEventCoverageRow[]);
    vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue([{ country: "US", indicator: "cpi", latestDate: "2020-01-01T00:00:00.000Z" }]);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "CPI").cells.USD).toEqual({ status: "current", latestDate: recent, source: "calendar" });
  });

  it("marks a stale calendar release distinctly from missing — an old release still counts as source: calendar", async () => {
    const old = daysAgo(200);
    vi.mocked(getEconomicEventCoverage).mockResolvedValue([{ country: "US", indicatorKey: "gdp", latestDate: old }]);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "GDP Growth").cells.USD).toEqual({ status: "stale", latestDate: old, source: "calendar" });
  });

  it("Manufacturing PMI has no FRED fallback at all — stays MISSING even if the FRED table has unrelated rows for that country", async () => {
    vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue([{ country: "US", indicator: "cpi", latestDate: daysAgo(1) }]);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "Manufacturing PMI").cells.USD.status).toBe("missing");
  });

  it("Policy Rate resolves the correct country-specific rate-decision calendar key per currency (GBP -> BoE)", async () => {
    const recent = daysAgo(3);
    vi.mocked(getEconomicEventCoverage).mockResolvedValue([{ country: "GB", indicatorKey: "boeRateDecision", latestDate: recent }]);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "Policy Rate").cells.GBP).toEqual({ status: "current", latestDate: recent, source: "calendar" });
    // A BoE release must never leak into a different currency's cell.
    expect(findRow(rows, "Policy Rate").cells.USD.status).toBe("missing");
  });

  it("never assigns NFP a FRED source — payrolls is a level, not the change figure", async () => {
    vi.mocked(getEconomicIndicatorCoverage).mockResolvedValue([{ country: "US", indicator: "payrolls", latestDate: daysAgo(1) }]);
    const rows = await buildEconomicCoverage();
    expect(findRow(rows, "Non-Farm Payrolls").cells.USD.status).toBe("missing");
  });

  it("returns one row per tracked currency for every indicator — no currency silently dropped", async () => {
    const rows = await buildEconomicCoverage();
    for (const row of rows) {
      expect(Object.keys(row.cells).sort()).toEqual(["AUD", "CAD", "CHF", "EUR", "GBP", "JPY", "NZD", "USD"]);
    }
  });
});
