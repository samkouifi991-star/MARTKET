import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/last-known-good");
import { getRetailSentimentFromStorage } from "@/services/market-data/last-known-good";
import { resolveRetailSentimentFactor } from "./sentiment";

beforeEach(() => vi.resetAllMocks());

describe("resolveRetailSentimentFactor — structural not_applicable vs. temporary unavailable", () => {
  it("marks BTCUSD not_applicable without ever calling the storage-only reader — no OANDA/IG/Myfxbook coverage for crypto", async () => {
    const factor = await resolveRetailSentimentFactor("BTCUSD", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/not applicable/i);
    expect(getRetailSentimentFromStorage).not.toHaveBeenCalled();
  });

  it("marks SPX500 not_applicable the same way — no OANDA/IG/Myfxbook coverage for indices", async () => {
    const factor = await resolveRetailSentimentFactor("SPX500", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(getRetailSentimentFromStorage).not.toHaveBeenCalled();
  });

  it("still calls the storage-only reader for EURUSD (OANDA covers it) — no stored observation stays 'unavailable', not 'not_applicable'", async () => {
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({
      provider: "oanda",
      source: "OANDA PositionBook",
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      nextExpectedUpdate: null,
      value: null,
      error: "No retail-sentiment observation has ever been stored for EURUSD",
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(getRetailSentimentFromStorage).toHaveBeenCalledWith("EURUSD");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.explanation).not.toMatch(/not applicable/i);
  });

  it("reports LIVE when the stored snapshot's own OANDA source timestamp is fresh — storage provenance never forces a downgrade", async () => {
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({
      provider: "oanda",
      source: "OANDA PositionBook",
      status: "live",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: { symbol: "EURUSD", pctLong: 62, pctShort: 38 },
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(factor.freshness).toBe("live");
  });

  it("reports DELAYED for a recently-stored OANDA snapshot", async () => {
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({
      provider: "oanda",
      source: "OANDA PositionBook",
      status: "delayed",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: { symbol: "EURUSD", pctLong: 62, pctShort: 38 },
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.source).toBe("OANDA PositionBook");
  });

  it("reports STALE and flags the age in the explanation for an old stored snapshot", async () => {
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({
      provider: "oanda",
      source: "OANDA PositionBook",
      status: "stale",
      fetchedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      sourceUpdatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      nextExpectedUpdate: null,
      value: { symbol: "EURUSD", pctLong: 62, pctShort: 38 },
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(factor.freshness).toBe("stale");
    expect(factor.explanation).toMatch(/last stored snapshot/i);
  });
});
