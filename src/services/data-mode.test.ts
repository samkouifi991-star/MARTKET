import { describe, expect, it } from "vitest";
import { allowsDemoFallback, isStrictLiveSymbol } from "./data-mode";

describe("data-mode strict-live symbols", () => {
  it("marks GBPUSD as the strict-live reference market", () => {
    expect(isStrictLiveSymbol("GBPUSD")).toBe(true);
    expect(isStrictLiveSymbol("EURUSD")).toBe(false);
  });

  it("allows demo fallback in hybrid mode for ordinary symbols", () => {
    expect(allowsDemoFallback("hybrid", "EURUSD")).toBe(true);
  });

  it("never allows demo fallback for GBPUSD, even in hybrid mode", () => {
    expect(allowsDemoFallback("hybrid", "GBPUSD")).toBe(false);
  });

  it("never allows demo fallback in live mode for any symbol", () => {
    expect(allowsDemoFallback("live", "EURUSD")).toBe(false);
    expect(allowsDemoFallback("live", "GBPUSD")).toBe(false);
  });
});
