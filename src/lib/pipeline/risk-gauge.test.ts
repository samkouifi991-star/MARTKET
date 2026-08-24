import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/market-data/last-known-good");
import { getQuoteWithFallback } from "@/services/market-data/last-known-good";
import { getLiveRiskGauge } from "./risk-gauge";

function quote(changePct24h: number, status: "live" | "unavailable" = "live") {
  return {
    provider: "fmp" as const,
    source: "Financial Modeling Prep",
    status,
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    nextExpectedUpdate: null,
    value: status === "live" ? { symbol: "X", price: 100, changePct24h, timestamp: new Date().toISOString() } : null,
  };
}

beforeEach(() => vi.resetAllMocks());

describe("getLiveRiskGauge", () => {
  it("computes a real gauge from the 6 required real quote inputs, honestly leaving the 3 unfed components unavailable", async () => {
    // SPX500, USDJPY, USDCHF, XAUUSD, AUDUSD, NZDUSD, BTCUSD — in that order
    vi.mocked(getQuoteWithFallback).mockImplementation(async () => quote(1));

    const { result, unavailableReason } = await getLiveRiskGauge();

    expect(unavailableReason).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.componentsAvailable).toBe(6);
    expect(result!.componentsTotal).toBe(9);
    const labels = result!.components.map((c) => c.label);
    expect(labels).toContain("Volatility index");
    expect(result!.components.find((c) => c.label === "Volatility index")!.detail).toMatch(/unavailable/i);
  });

  it("returns unavailable (never a fabricated 0) when a required real input, like Bitcoin, has no usable quote", async () => {
    vi.mocked(getQuoteWithFallback).mockImplementation(async (symbol: string) => (symbol === "BTCUSD" ? quote(0, "unavailable") : quote(1)));

    const { result, unavailableReason } = await getLiveRiskGauge();

    expect(result).toBeNull();
    expect(unavailableReason).toMatch(/Bitcoin/);
  });
});
