import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getInstitutionalPositioning } from "./cftc";
import { clearRequestCache } from "./request-cache";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// GBPUSD's real symbol-map.ts entry: financial_futures, Asset Manager first.
// market_and_exchange_names must be present so discoverCftcContract() (which
// groups candidate rows by this exact field) resolves to a contract at all
// — the fetch mock below ignores which URL (discovery vs. data fetch) it
// was called for and returns these same rows either way.
const MARKET_ROW_BASE = {
  asset_mgr_positions_long: 60000,
  asset_mgr_positions_short: 14000,
  open_interest_all: 210000,
  market_and_exchange_names: "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE",
  cftc_contract_market_code: "096742",
};

describe("CFTC freshness classification", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    clearRequestCache(); // discovery results are cached across calls — each test needs a clean slate
  });
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

describe("CFTC contract discovery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    clearRequestCache();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolves to the naming variant with the most recent report, not a stale exact-string match", async () => {
    // Simulates exactly the bug this replaces: an old exchange-name string
    // ("...OLD EXCHANGE NAME") only has ancient reports, while CFTC has
    // since been publishing the same underlying contract under a renamed
    // string. A hardcoded exact reportName would still find the old rows
    // and report them as current; discovery must prefer the fresher name.
    const oldName = "BRITISH POUND STERLING - OLD EXCHANGE NAME";
    const newName = "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE";
    const rows = [
      { ...MARKET_ROW_BASE, market_and_exchange_names: oldName, report_date_as_yyyy_mm_dd: isoDaysAgo(1648) },
      { ...MARKET_ROW_BASE, market_and_exchange_names: newName, report_date_as_yyyy_mm_dd: isoDaysAgo(3) },
    ];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(rows));

    const result = await getInstitutionalPositioning("GBPUSD");

    expect(result.status).toBe("live");
    expect(result.value?.marketAndExchangeName).toBe(newName);
    expect(result.value?.cftcContractMarketCode).toBe("096742");
  });

  it("resolves through a real-world rename that drops a word from the anchor (BRITISH POUND STERLING -> BRITISH POUND)", async () => {
    // The actual bug found by running cftc-verify.ts against the live CFTC
    // API: GBP futures' market_and_exchange_names was "BRITISH POUND
    // STERLING - CHICAGO MERCANTILE EXCHANGE" until 2022-02-01, then CFTC
    // renamed it to "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE" (same
    // cftc_contract_market_code, "STERLING" dropped). A full-name anchor
    // ("BRITISH POUND STERLING") never matches the new string at all; the
    // shortened two-word anchor ("BRITISH POUND") must still find it.
    const deadName = "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE";
    const currentName = "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE";
    const rows = [
      { ...MARKET_ROW_BASE, market_and_exchange_names: deadName, cftc_contract_market_code: "096742", report_date_as_yyyy_mm_dd: isoDaysAgo(1661) },
      { ...MARKET_ROW_BASE, market_and_exchange_names: currentName, cftc_contract_market_code: "096742", report_date_as_yyyy_mm_dd: isoDaysAgo(8) },
    ];
    vi.mocked(fetch).mockResolvedValue(jsonResponse(rows));

    const result = await getInstitutionalPositioning("GBPUSD");

    expect(result.status).toBe("live");
    expect(result.value?.marketAndExchangeName).toBe(currentName);
  });

  it("reports unavailable, not error, when discovery finds no matching rows at all", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    const result = await getInstitutionalPositioning("GBPUSD");
    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/discovery found no CFTC rows/i);
  });
});
