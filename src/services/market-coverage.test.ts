import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "@/lib/instruments";
import { coverageReasonFor, coverageStatusFor, isPubliclyLaunchable, publicInstruments } from "./market-coverage";

describe("coverageStatusFor", () => {
  it("classifies every strict-live symbol as LAUNCH_READY", () => {
    for (const key of ["GBPUSD", "EURUSD", "USDJPY", "XAUUSD", "BTCUSD", "SPX500", "GBPJPY", "ETHUSD"]) {
      expect(coverageStatusFor(key)).toBe("LAUNCH_READY");
    }
  });

  it("classifies NAS100 as BLOCKED with a documented, non-empty reason", () => {
    expect(coverageStatusFor("NAS100")).toBe("BLOCKED");
    expect(coverageReasonFor("NAS100")).toMatch(/402/);
  });

  it("classifies a not-yet-promoted market with real provider config as PARTIAL, not BLOCKED", () => {
    expect(coverageStatusFor("DAX40")).toBe("PARTIAL");
    expect(coverageStatusFor("COPPER")).toBe("PARTIAL");
    expect(coverageReasonFor("DAX40")).toBeNull();
  });

  it("a LAUNCH_READY market has no coverage reason (none needed)", () => {
    expect(coverageReasonFor("GBPUSD")).toBeNull();
  });
});

describe("isPubliclyLaunchable", () => {
  it("is true only for LAUNCH_READY markets", () => {
    expect(isPubliclyLaunchable("GBPUSD")).toBe(true);
    expect(isPubliclyLaunchable("NAS100")).toBe(false);
    expect(isPubliclyLaunchable("DAX40")).toBe(false);
  });
});

describe("publicInstruments", () => {
  it("never includes NAS100/DAX40/COPPER/XPTUSD/WTIUSD/NATGAS — the markets called out as blocked/incomplete", () => {
    const symbols = publicInstruments().map((i) => i.symbol);
    for (const blocked of ["NAS100", "DAX40", "COPPER", "XPTUSD", "WTIUSD", "NATGAS"]) {
      expect(symbols).not.toContain(blocked);
    }
  });

  it("is a strict subset of INSTRUMENTS, preserving order, never inventing a symbol", () => {
    const publicSymbols = publicInstruments().map((i) => i.symbol);
    const allSymbols = INSTRUMENTS.map((i) => i.symbol);
    for (const s of publicSymbols) expect(allSymbols).toContain(s);
    // Order preserved: publicInstruments() is a filter, not a re-sort.
    const filteredAll = allSymbols.filter((s) => publicSymbols.includes(s));
    expect(publicSymbols).toEqual(filteredAll);
  });

  it("includes every LAUNCH_READY market and only LAUNCH_READY markets", () => {
    const publicSymbols = new Set(publicInstruments().map((i) => i.symbol));
    for (const i of INSTRUMENTS) {
      expect(publicSymbols.has(i.symbol)).toBe(coverageStatusFor(i.symbol) === "LAUNCH_READY");
    }
  });
});
