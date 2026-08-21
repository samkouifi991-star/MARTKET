import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/cftc");
vi.mock("@/services/market-data/retail-sentiment");
vi.mock("@/services/market-data/last-known-good");
import * as cftc from "@/services/market-data/cftc";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { getQuoteWithFallback } from "@/services/market-data/last-known-good";
import { resolveInstitutionalFactor, resolveSmartMoney } from "./positioning";

beforeEach(() => vi.resetAllMocks());

describe("resolveInstitutionalFactor / resolveSmartMoney — structural not_applicable when no CFTC contract exists", () => {
  it("marks EURGBP not_applicable without ever calling the CFTC client — crosses have no CFTC-reportable futures contract", async () => {
    const factor = await resolveInstitutionalFactor("EURGBP", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/not applicable/i);
    expect(cftc.getInstitutionalPositioning).not.toHaveBeenCalled();
  });

  it("marks Smart Money not_applicable for EURGBP the same way, without calling any provider", async () => {
    const result = await resolveSmartMoney("EURGBP");

    expect(result.freshness).toBe("not_applicable");
    expect(result.signal).toBe("None");
    expect(cftc.getInstitutionalPositioning).not.toHaveBeenCalled();
    expect(retailSentiment.getRetailSentiment).not.toHaveBeenCalled();
    expect(getQuoteWithFallback).not.toHaveBeenCalled();
  });

  it("still calls the CFTC client for EURUSD (a real CFTC-reportable contract) — a real provider failure stays 'unavailable', not 'not_applicable'", async () => {
    vi.mocked(cftc.getInstitutionalPositioning).mockResolvedValue({
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

    expect(cftc.getInstitutionalPositioning).toHaveBeenCalledWith("EURUSD");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.explanation).not.toMatch(/not applicable/i);
  });
});
