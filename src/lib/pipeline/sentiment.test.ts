import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/retail-sentiment");
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { resolveRetailSentimentFactor } from "./sentiment";

beforeEach(() => vi.resetAllMocks());

describe("resolveRetailSentimentFactor — structural not_applicable vs. temporary unavailable", () => {
  it("marks BTCUSD not_applicable without ever calling the provider — no Myfxbook/IG coverage for crypto", async () => {
    const factor = await resolveRetailSentimentFactor("BTCUSD", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(factor.rawScore).toBe(0);
    expect(factor.explanation).toMatch(/not applicable/i);
    expect(retailSentiment.getRetailSentiment).not.toHaveBeenCalled();
  });

  it("marks SPX500 not_applicable the same way — no Myfxbook/IG coverage for indices", async () => {
    const factor = await resolveRetailSentimentFactor("SPX500", "live");

    expect(factor.freshness).toBe("not_applicable");
    expect(retailSentiment.getRetailSentiment).not.toHaveBeenCalled();
  });

  it("still calls the provider for EURUSD (Myfxbook covers it) — a real provider failure stays 'unavailable', not 'not_applicable'", async () => {
    vi.mocked(retailSentiment.getRetailSentiment).mockResolvedValue({
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

    expect(retailSentiment.getRetailSentiment).toHaveBeenCalledWith("EURUSD");
    expect(factor.freshness).toBe("unavailable");
    expect(factor.explanation).not.toMatch(/not applicable/i);
  });
});
