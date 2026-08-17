import { describe, expect, it } from "vitest";
import { computeRiskGauge, RiskGaugeInputs } from "./risk-gauge";

const baseInputs: RiskGaugeInputs = {
  equityIndexChangePct: 0,
  volatilityIndexLevel: 16,
  volatilityIndexAvg: 16,
  yieldCurveSlopeChangeBp: 0,
  usdJpyChangePct: 0,
  usdChfChangePct: 0,
  goldChangePct: 0,
  highBetaFxChangePct: 0,
  btcChangePct: 0,
  creditSpread: 1.6,
};

describe("computeRiskGauge", () => {
  it("reads near 50/Neutral when every input is flat", () => {
    const result = computeRiskGauge(baseInputs);
    expect(result.value).toBe(50);
    expect(result.label).toBe("Neutral");
  });

  it("reads strongly risk-on when equities/high-beta FX/BTC rally and havens weaken", () => {
    const result = computeRiskGauge({
      ...baseInputs,
      equityIndexChangePct: 1.5,
      volatilityIndexLevel: 12,
      usdJpyChangePct: 1.2, // yen weakening
      usdChfChangePct: 1.0, // franc weakening
      goldChangePct: -1.0,
      highBetaFxChangePct: 1.2,
      btcChangePct: 4,
    });
    expect(result.value).toBeGreaterThan(60);
    expect(result.label).toMatch(/Risk-On/);
  });

  it("reads strongly risk-off when equities fall and havens (JPY/CHF/gold) strengthen", () => {
    const result = computeRiskGauge({
      ...baseInputs,
      equityIndexChangePct: -2,
      volatilityIndexLevel: 28,
      usdJpyChangePct: -1.5, // yen strengthening
      usdChfChangePct: -1.2, // franc strengthening
      goldChangePct: 1.5,
      highBetaFxChangePct: -1.5,
      btcChangePct: -6,
    });
    expect(result.value).toBeLessThan(40);
    expect(result.label).toMatch(/Risk-Off/);
  });

  it("keeps the value within 0..100 even for extreme inputs", () => {
    const extreme = computeRiskGauge({
      ...baseInputs,
      equityIndexChangePct: 20,
      usdJpyChangePct: 20,
      usdChfChangePct: 20,
      goldChangePct: -20,
      highBetaFxChangePct: 20,
      btcChangePct: 50,
    });
    expect(extreme.value).toBeLessThanOrEqual(100);
    expect(extreme.value).toBeGreaterThanOrEqual(0);
  });

  it("marks unavailable components with zero contribution instead of fabricating a value", () => {
    const result = computeRiskGauge({ ...baseInputs, volatilityIndexLevel: null, creditSpread: null, yieldCurveSlopeChangeBp: null });
    expect(result.componentsAvailable).toBe(6);
    const vol = result.components.find((c) => c.label === "Volatility index")!;
    expect(vol.contribution).toBe(0);
    expect(vol.detail).toBe("Data temporarily unavailable");
  });
});
