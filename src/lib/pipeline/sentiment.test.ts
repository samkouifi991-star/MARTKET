import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/last-known-good");
import { getRetailSentimentWithFallback } from "@/services/market-data/last-known-good";
import { resolveRetailSentimentFactor } from "./sentiment";

beforeEach(() => vi.resetAllMocks());

describe("resolveRetailSentimentFactor — structural not_applicable vs. temporary unavailable", () => {
  it("marks BTCUSD not_applicable without ever calling the storage-first wrapper — no Myfxbook/IG coverage for crypto", async () => {
    const factor = await resolveRetailSentimentFactor("BTCUSD", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/not applicable/i);
    expect(getRetailSentimentWithFallback).not.toHaveBeenCalled();
  });

  it("marks SPX500 not_applicable the same way — no Myfxbook/IG coverage for indices", async () => {
    const factor = await resolveRetailSentimentFactor("SPX500", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(getRetailSentimentWithFallback).not.toHaveBeenCalled();
  });

  it("still calls the storage-first wrapper for EURUSD (Myfxbook covers it) — a real failure stays 'unavailable', not 'not_applicable'", async () => {
    vi.mocked(getRetailSentimentWithFallback).mockResolvedValue({
      provider: "myfxbook",
      source: "Myfxbook Community Outlook",
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: null,
      nextExpectedUpdate: null,
      value: null,
      error: "simulated outage",
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(getRetailSentimentWithFallback).toHaveBeenCalledWith("EURUSD");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.explanation).not.toMatch(/not applicable/i);
  });

  it("reports DELAYED (not UNAVAILABLE) when the wrapper falls back to a recently-stored snapshot", async () => {
    vi.mocked(getRetailSentimentWithFallback).mockResolvedValue({
      provider: "myfxbook",
      source: "Myfxbook Community Outlook (last known good — stored)",
      status: "delayed",
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      nextExpectedUpdate: null,
      value: { symbol: "EURUSD", pctLong: 62, pctShort: 38 },
      error: "Live refresh unavailable — showing last stored snapshot",
    });

    const factor = await resolveRetailSentimentFactor("EURUSD", "live");

    expect(factor.freshness).toBe("delayed");
    expect(factor.explanation).toMatch(/last successfully stored/i);
  });
});
