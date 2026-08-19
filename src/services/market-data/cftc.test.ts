import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getInstitutionalPositioning } from "./cftc";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// GBPUSD's real symbol-map.ts entry: financial_futures, Asset Manager first.
const MARKET_ROW_BASE = {
  asset_mgr_positions_long: 60000,
  asset_mgr_positions_short: 14000,
  open_interest_all: 210000,
};

describe("CFTC freshness classification", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("re-sorts client-side and picks the true latest report even if the server returns rows out of order", async () => {
    const actualLatest = isoDaysAgo(3);
    // Deliberately reversed / scrambled order — the fix must not trust it.
    const rows = [
      { ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: isoDaysAgo(1648) }, // the exact bug: a ~4.5-year-old row
      { ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: actualLatest },
      { ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: isoDaysAgo(10) },
    ];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(rows));

    const result = await getInstitutionalPositioning("GBPUSD");

    expect(result.status).toBe("live");
    expect(result.value?.reportDate).toBe(new Date(actualLatest).toISOString());
  });

  it("classifies a report within the normal weekly window as live", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: isoDaysAgo(4) }]));
    const result = await getInstitutionalPositioning("GBPUSD");
    expect(result.status).toBe("live");
    expect(result.value).not.toBeNull();
  });

  it("classifies a moderately old report as stale but still returns a usable value", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: isoDaysAgo(25) }]));
    const result = await getInstitutionalPositioning("GBPUSD");
    expect(result.status).toBe("stale");
    expect(result.value).not.toBeNull();
  });

  it("never reports a multi-year-old record as live — rejects it as unavailable with a null value instead", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([{ ...MARKET_ROW_BASE, report_date_as_yyyy_mm_dd: isoDaysAgo(1648) }]));
    const result = await getInstitutionalPositioning("GBPUSD");
    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/too old/i);
  });
});
