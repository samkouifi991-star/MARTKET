import { describe, expect, it } from "vitest";
import { allowsDemoFallback, isStrictLiveSymbol } from "./data-mode";

const STRICT_LIVE = ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500", "AUDUSD", "USDCAD", "XAGUSD", "DJ30", "USDCHF", "NZDUSD", "GBPJPY"];

describe("data-mode strict-live symbols", () => {
  it("marks GBPUSD and every promoted batch as strict-live, ordinary symbols as not", () => {
    for (const symbol of STRICT_LIVE) {
      expect(isStrictLiveSymbol(symbol)).toBe(true);
    }
    // EURGBP and NAS100 are deliberately not promoted — EURGBP is held
    // pending a separate promotion decision (its OANDA price/candle and EU
    // FRED macro coverage are both verified, but it hasn't been added yet),
    // NAS100 is blocked on an FMP plan/entitlement issue (402 Payment
    // Required on ^NDX) with no stored fallback to degrade to.
    expect(isStrictLiveSymbol("EURGBP")).toBe(false);
    expect(isStrictLiveSymbol("NAS100")).toBe(false);
  });

  it("allows demo fallback in hybrid mode for ordinary symbols", () => {
    expect(allowsDemoFallback("hybrid", "EURGBP")).toBe(true);
  });

  it("never allows demo fallback for any promoted symbol, even in hybrid mode", () => {
    for (const symbol of STRICT_LIVE) {
      expect(allowsDemoFallback("hybrid", symbol)).toBe(false);
    }
  });

  it("never allows demo fallback in live mode for any symbol", () => {
    expect(allowsDemoFallback("live", "EURGBP")).toBe(false);
    expect(allowsDemoFallback("live", "GBPUSD")).toBe(false);
  });
});
