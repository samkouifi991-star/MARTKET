import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/last-known-good");
import { getPositioningWithFallback, getRetailSentimentFromStorage, getQuoteWithFallback } from "@/services/market-data/last-known-good";
import { resolveInstitutionalFactor, resolveSmartMoney } from "./positioning";

beforeEach(() => vi.resetAllMocks());

describe("resolveInstitutionalFactor / resolveSmartMoney — structural not_applicable when no CFTC contract exists", () => {
  it("marks EURGBP not_applicable without ever calling the storage-first CFTC wrapper — crosses have no CFTC-reportable futures contract", async () => {
    const factor = await resolveInstitutionalFactor("EURGBP", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/not applicable/i);
    expect(getPositioningWithFallback).not.toHaveBeenCalled();
  });

  it("marks Smart Money not_applicable for EURGBP the same way, without calling any provider", async () => {
    const result = await resolveSmartMoney("EURGBP");

    expect(result.freshness).toBe("not_applicable");
    expect(result.signal).toBe("None");
    expect(getPositioningWithFallback).not.toHaveBeenCalled();
    expect(getRetailSentimentFromStorage).not.toHaveBeenCalled();
    expect(getQuoteWithFallback).not.toHaveBeenCalled();
  });

  it("still calls the storage-first CFTC wrapper for EURUSD (a real CFTC-reportable contract) — a real failure stays 'unavailable', not 'not_applicable'", async () => {
    vi.mocked(getPositioningWithFallback).mockResolvedValue({
      provider: "cftc",
      source: "CFTC Traders in Financial Futures",
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      nextExpectedUpdate: null,
      value: null,
      error: "simulated outage",
    });

    const factor = await resolveInstitutionalFactor("EURUSD", "live");

    expect(getPositioningWithFallback).toHaveBeenCalledWith("EURUSD", false);
    expect(factor.freshness).toBe("unavailable");
    expect(factor.explanation).not.toMatch(/not applicable/i);
  });

  it("reports DELAYED (not UNAVAILABLE) when the wrapper falls back to a recently-stored report", async () => {
    vi.mocked(getPositioningWithFallback).mockResolvedValue({
      provider: "cftc",
      source: "CFTC Traders in Financial Futures (last known good — stored)",
      status: "delayed",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: {
        classification: "Asset Manager",
        reportDate: new Date().toISOString(),
        longContracts: 60000,
        shortContracts: 14000,
        netPositioning: 46000,
        pctLong: 81,
        pctShort: 19,
        openInterest: 210000,
        netWeeklyChange: 2000,
        percentile1y: 78,
        percentile3y: 74,
        direction: "Bullish",
        strength: "Strong",
        netHistory: [{ reportDate: new Date().toISOString(), netPositioning: 46000 }],
        marketAndExchangeName: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
        cftcContractMarketCode: null,
      },
      error: "Live refresh unavailable — showing last stored CFTC report",
    });

    const factor = await resolveInstitutionalFactor("EURUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.rawScore).not.toBe(0);
    expect(factor.explanation).toMatch(/last stored CFTC report/i);
  });
});
