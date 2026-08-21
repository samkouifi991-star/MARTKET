import { describe, expect, it } from "vitest";
import { allowsDemoFallback, isStrictLiveSymbol } from "./data-mode";

const STRICT_LIVE = ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500", "AUDUSD", "USDCAD", "XAGUSD", "DJ30"];

describe("data-mode strict-live symbols", () => {
  it("marks GBPUSD and every promoted batch as strict-live, ordinary symbols as not", () => {
    for (const symbol of STRICT_LIVE) {
      expect(isStrictLiveSymbol(symbol)).toBe(true);
    }
    // NZDUSD and NAS100 are deliberately not promoted — NZDUSD was never
    // in a batch, NAS100 is blocked on an FMP plan/entitlement issue
    // (402 Payment Required on ^NDX) with no stored fallback to degrade to.
    expect(isStrictLiveSymbol("NZDUSD")).toBe(false);
    expect(isStrictLiveSymbol("NAS100")).toBe(false);
  });

  it("allows demo fallback in hybrid mode for ordinary symbols", () => {
    expect(allowsDemoFallback("hybrid", "NZDUSD")).toBe(true);
  });

  it("never allows demo fallback for any promoted symbol, even in hybrid mode", () => {
    for (const symbol of STRICT_LIVE) {
      expect(allowsDemoFallback("hybrid", symbol)).toBe(false);
    }
  });

  it("never allows demo fallback in live mode for any symbol", () => {
    expect(allowsDemoFallback("live", "NZDUSD")).toBe(false);
    expect(allowsDemoFallback("live", "GBPUSD")).toBe(false);
  });
});
