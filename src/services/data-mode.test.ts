import { describe, expect, it } from "vitest";
import { allowsDemoFallback, isStrictLiveSymbol } from "./data-mode";

const STRICT_LIVE = ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500", "AUDUSD", "USDCAD", "XAGUSD", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD", "USDCHF", "NZDUSD", "GBPJPY", "EURGBP", "EURJPY"];

describe("data-mode strict-live symbols", () => {
  it("marks GBPUSD and every promoted batch as strict-live, ordinary symbols as not", () => {
    for (const symbol of STRICT_LIVE) {
      expect(isStrictLiveSymbol(symbol)).toBe(true);
    }
    // All 10 configured OANDA FX pairs are now promoted, so NAS100 is the
    // remaining "ordinary, not-yet-promoted" example — it's blocked on an
    // FMP plan/entitlement issue (402 Payment Required on ^NDX) with no
    // stored fallback to degrade to, so it's a structurally stable choice
    // (not a symbol likely to be promoted out from under this test soon).
    expect(isStrictLiveSymbol("NAS100")).toBe(false);
  });

  it("allows demo fallback in hybrid mode for ordinary symbols", () => {
    expect(allowsDemoFallback("hybrid", "NAS100")).toBe(true);
  });

  it("never allows demo fallback for any promoted symbol, even in hybrid mode", () => {
    for (const symbol of STRICT_LIVE) {
      expect(allowsDemoFallback("hybrid", symbol)).toBe(false);
    }
  });

  it("never allows demo fallback in live mode for any symbol", () => {
    expect(allowsDemoFallback("live", "NAS100")).toBe(false);
    expect(allowsDemoFallback("live", "GBPUSD")).toBe(false);
  });
});
