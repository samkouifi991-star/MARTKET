import { describe, expect, it } from "vitest";
import { classifyRegime, regimeClarity } from "./regime";

describe("classifyRegime", () => {
  it("classifies rising real yields + strengthening USD as hawkish tightening", () => {
    expect(classifyRegime({ realYieldTrend: 0.3, usdTrend: 1.0, vixLevel: 16, vixTrend: 0 })).toBe("HawkishTightening");
  });

  it("classifies falling real yields + weakening USD as dovish easing", () => {
    expect(classifyRegime({ realYieldTrend: -0.3, usdTrend: -1.0, vixLevel: 16, vixTrend: 0 })).toBe("DovishEasing");
  });

  it("classifies an elevated or sharply rising VIX as risk-off, overriding a would-be hawkish read", () => {
    expect(classifyRegime({ realYieldTrend: 0.3, usdTrend: 1.0, vixLevel: 30, vixTrend: 0 })).toBe("RiskOff");
    expect(classifyRegime({ realYieldTrend: 0, usdTrend: 0, vixLevel: 18, vixTrend: 8 })).toBe("RiskOff");
  });

  it("classifies a calm, falling VIX as risk-on", () => {
    expect(classifyRegime({ realYieldTrend: 0, usdTrend: 0, vixLevel: 12, vixTrend: -2 })).toBe("RiskOn");
  });

  it("falls back to Neutral when nothing crosses a threshold clearly", () => {
    expect(classifyRegime({ realYieldTrend: 0.02, usdTrend: 0.1, vixLevel: 18, vixTrend: 0.5 })).toBe("Neutral");
  });

  it("requires BOTH real yield and USD to move together for a hawkish/dovish read, not just one", () => {
    // Real yields rising but USD not confirming — should not read as hawkish tightening.
    expect(classifyRegime({ realYieldTrend: 0.5, usdTrend: 0, vixLevel: 16, vixTrend: 0 })).toBe("Neutral");
  });
});

describe("regimeClarity", () => {
  it("gives Neutral a low clarity score", () => {
    expect(regimeClarity("Neutral", { realYieldTrend: 0, usdTrend: 0, vixLevel: 18, vixTrend: 0 })).toBeLessThan(0.5);
  });

  it("gives a well-past-threshold hawkish read higher clarity than a barely-past-threshold one", () => {
    const barely = regimeClarity("HawkishTightening", { realYieldTrend: 0.16, usdTrend: 0.51, vixLevel: 16, vixTrend: 0 });
    const strong = regimeClarity("HawkishTightening", { realYieldTrend: 1.0, usdTrend: 3.0, vixLevel: 16, vixTrend: 0 });
    expect(strong).toBeGreaterThan(barely);
  });

  it("always returns a value within [0, 1]", () => {
    expect(regimeClarity("RiskOff", { realYieldTrend: 0, usdTrend: 0, vixLevel: 80, vixTrend: 50 })).toBeLessThanOrEqual(1);
    expect(regimeClarity("RiskOn", { realYieldTrend: 0, usdTrend: 0, vixLevel: 5, vixTrend: -10 })).toBeLessThanOrEqual(1);
  });
});
