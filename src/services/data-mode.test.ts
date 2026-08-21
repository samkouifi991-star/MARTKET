import { describe, expect, it } from "vitest";
import { allowsDemoFallback, isStrictLiveSymbol } from "./data-mode";

describe("data-mode strict-live symbols", () => {
  it("marks GBPUSD and the second-phase batch as strict-live, ordinary symbols as not", () => {
    for (const symbol of ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500"]) {
      expect(isStrictLiveSymbol(symbol)).toBe(true);
    }
    expect(isStrictLiveSymbol("USDCAD")).toBe(false);
  });

  it("allows demo fallback in hybrid mode for ordinary symbols", () => {
    expect(allowsDemoFallback("hybrid", "USDCAD")).toBe(true);
  });

  it("never allows demo fallback for GBPUSD or the second-phase batch, even in hybrid mode", () => {
    for (const symbol of ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500"]) {
      expect(allowsDemoFallback("hybrid", symbol)).toBe(false);
    }
  });

  it("never allows demo fallback in live mode for any symbol", () => {
    expect(allowsDemoFallback("live", "USDCAD")).toBe(false);
    expect(allowsDemoFallback("live", "GBPUSD")).toBe(false);
  });
});
