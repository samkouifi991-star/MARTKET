import { describe, expect, it, vi } from "vitest";

vi.mock("../market-data/fmp");

import * as fmp from "../market-data/fmp";
import { fmpEconomicCalendarProvider } from "./fmp-provider";

describe("fmpEconomicCalendarProvider", () => {
  it("classifies a recognizable event and reports honest null for revisedPrevious (FMP doesn't supply it)", async () => {
    vi.mocked(fmp.getEconomicCalendar).mockResolvedValue({
      provider: "fmp",
      source: "FMP",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: [{ id: "fmp-US-CPI-2027-01-01-0", country: "United States", event: "CPI m/m", dateTime: "2027-01-15T13:30:00.000Z", impact: "High", actual: 0.3, previous: 0.2, forecast: 0.2 }],
    });

    const result = await fmpEconomicCalendarProvider.getReleases("2027-01-01", "2027-01-31");
    expect(result.value).toHaveLength(1);
    const release = result.value![0];
    expect(release.indicatorKey).toBe("cpi");
    expect(release.importanceTier).toBe("HIGH");
    expect(release.revisedPrevious).toBeNull();
    expect(release.actual).toBe(0.3);
  });

  it("leaves indicatorKey and importanceTier null for an event the taxonomy can't classify, rather than guessing", async () => {
    vi.mocked(fmp.getEconomicCalendar).mockResolvedValue({
      provider: "fmp",
      source: "FMP",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: [{ id: "fmp-XX-Obscure-2027-01-01-0", country: "Elsewhere", event: "Some Obscure Regional Survey", dateTime: "2027-01-15T13:30:00.000Z", impact: null, actual: 1, previous: 1, forecast: 1 }],
    });

    const result = await fmpEconomicCalendarProvider.getReleases("2027-01-01", "2027-01-31");
    expect(result.value![0].indicatorKey).toBeNull();
    expect(result.value![0].importanceTier).toBeNull();
  });

  it("passes through a failed/unavailable live fetch unchanged", async () => {
    vi.mocked(fmp.getEconomicCalendar).mockResolvedValue({
      provider: "fmp",
      source: "FMP",
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      nextExpectedUpdate: null,
      value: null,
      error: "calendar unavailable",
    });

    const result = await fmpEconomicCalendarProvider.getReleases("2027-01-01", "2027-01-31");
    expect(result.value).toBeNull();
    expect(result.status).toBe("unavailable");
  });
});
