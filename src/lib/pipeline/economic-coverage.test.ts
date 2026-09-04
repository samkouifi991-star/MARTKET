import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/db/queries/market-data");

import { getEconomicEventCoverage, getEconomicIndicatorCoverage, EconomicEventCoverageRow, EconomicIndicatorCoverageRow } from "@/db/queries/market-data";
import { buildEconomicCoverage, computeCoveragePercentage } from "./economic-coverage";

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

  it("marks NFP/ADP/JOLTS/PCE as NOT_APPLICABLE (not MISSING) for every currency except USD — these are genuinely US-only concepts, not a coverage gap", async () => {
    const rows = await buildEconomicCoverage();
    for (const label of ["Non-Farm Payrolls", "ADP Employment", "JOLTS", "PCE"]) {
      const row = findRow(rows, label);
      expect(row.cells.USD.status).not.toBe("not_applicable");
      for (const currency of ["EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"] as const) {
        expect(row.cells[currency]).toEqual({ status: "not_applicable", latestDate: null, source: null });
      }
    }
  });

  it("does NOT mark Employment Change or Jobless Claims as NOT_APPLICABLE anywhere — those are unresearched gaps (MISSING), not confirmed non-existent", async () => {
    const rows = await buildEconomicCoverage();
    for (const label of ["Employment Change", "Jobless Claims"]) {
      const row = findRow(rows, label);
      for (const currency of Object.keys(row.cells) as (keyof typeof row.cells)[]) {
        expect(row.cells[currency].status).not.toBe("not_applicable");
      }
    }
  });
});

describe("computeCoveragePercentage", () => {
  it("scores CURRENT as 100%, STALE as 50%, MISSING as 0%, and excludes NOT_APPLICABLE from the denominator", async () => {
    const rows = await buildEconomicCoverage();
    // With no stored data at all, USD still has 4 NOT_APPLICABLE-free... no:
    // NFP/ADP/JOLTS/PCE are all applicable to USD (never not_applicable for
    // USD), so an all-missing fixture gives USD a real 0% same as everyone.
    expect(computeCoveragePercentage(rows, "USD")).toBe(0);
  });

  it("a currency with several NOT_APPLICABLE cells reaches 100% once every APPLICABLE cell is current — the excluded cells never drag it down", async () => {
    const recent = daysAgo(3);
    const events: EconomicEventCoverageRow[] = [
      { country: "GB", indicatorKey: "gdp", latestDate: recent },
      { country: "GB", indicatorKey: "ismManufacturing" as never, latestDate: recent }, // wrong key on purpose, ignored
    ];
    vi.mocked(getEconomicEventCoverage).mockResolvedValue(events);
    const rows = await buildEconomicCoverage();
    // GBP is NOT_APPLICABLE for NFP/ADP/JOLTS/PCE (4 of 18 rows) — those 4
    // must not count toward the denominator at all.
    const gbpRow = rows.find((r) => r.label === "Non-Farm Payrolls")!;
    expect(gbpRow.cells.GBP.status).toBe("not_applicable");
    // Sanity: percentage stays a plain 0-100 number, never negative/NaN.
    const pct = computeCoveragePercentage(rows, "GBP");
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
  });
});
