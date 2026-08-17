// Risk-On/Risk-Off engine — a transparent 0-100 composite computed from
// real cross-asset signals. Pure function: takes plain % changes (or levels)
// so it can be fed either live quotes or fixtures, and returns exactly which
// component contributed what, matching the spec's requirement that the
// Details page can explain the current reading.
import { classifyRiskGauge, DEFAULT_RISK_GAUGE_BANDS } from "@/lib/config";
import { RiskGaugeComponent, RiskGaugeData } from "@/lib/types";

export type RiskGaugeInputs = {
  equityIndexChangePct: number; // e.g. S&P 500 24h change
  volatilityIndexLevel: number | null; // e.g. VIX level; null if unavailable
  volatilityIndexAvg: number; // a recent baseline (e.g. 20d average) to compare against
  yieldCurveSlopeChangeBp: number | null; // change in 10y-2y slope, basis points
  usdJpyChangePct: number; // USD/JPY change — proxy for yen behavior (inverted below)
  usdChfChangePct: number; // USD/CHF change — proxy for franc behavior (inverted below)
  goldChangePct: number;
  highBetaFxChangePct: number; // average of AUD/NZD-style currencies vs USD
  btcChangePct: number;
  creditSpread: number | null; // e.g. high-yield spread level, %; null if unavailable
};

function clampContribution(v: number, max = 20): number {
  return Math.max(-max, Math.min(max, v));
}

export function computeRiskGauge(inputs: RiskGaugeInputs): RiskGaugeData & { componentsAvailable: number; componentsTotal: number } {
  const components: RiskGaugeComponent[] = [];
  let available = 0;
  const total = 9;

  components.push({
    label: "Equity index performance",
    contribution: clampContribution(inputs.equityIndexChangePct * 3),
    detail: `Major equity index 24h change: ${inputs.equityIndexChangePct.toFixed(2)}%`,
  });
  available++;

  if (inputs.volatilityIndexLevel !== null) {
    components.push({
      label: "Volatility index",
      contribution: clampContribution((inputs.volatilityIndexAvg - inputs.volatilityIndexLevel) * 1.6),
      detail: `Volatility index at ${inputs.volatilityIndexLevel.toFixed(1)} vs. its recent average of ${inputs.volatilityIndexAvg.toFixed(1)}`,
    });
    available++;
  } else {
    components.push({ label: "Volatility index", contribution: 0, detail: "Data temporarily unavailable" });
  }

  if (inputs.yieldCurveSlopeChangeBp !== null) {
    components.push({
      label: "Government bond yields",
      contribution: clampContribution(inputs.yieldCurveSlopeChangeBp * 0.4),
      detail: `Yield curve (10y-2y) slope change: ${inputs.yieldCurveSlopeChangeBp > 0 ? "+" : ""}${inputs.yieldCurveSlopeChangeBp.toFixed(0)}bp`,
    });
    available++;
  } else {
    components.push({ label: "Government bond yields", contribution: 0, detail: "Data temporarily unavailable" });
  }

  const jpyStrength = -inputs.usdJpyChangePct;
  components.push({
    label: "Japanese yen",
    contribution: clampContribution(-jpyStrength * 3.5), // yen strength = safe-haven demand = risk-off
    detail: `USD/JPY 24h change implies yen ${jpyStrength > 0 ? "strengthening (safe-haven demand)" : "weakening (risk-on funding flows)"}`,
  });
  available++;

  const chfStrength = -inputs.usdChfChangePct;
  components.push({
    label: "Swiss franc",
    contribution: clampContribution(-chfStrength * 3.5),
    detail: `USD/CHF 24h change implies franc ${chfStrength > 0 ? "strengthening (safe-haven demand)" : "weakening"}`,
  });
  available++;

  components.push({
    label: "Gold",
    contribution: clampContribution(-inputs.goldChangePct * 2.4),
    detail: `Gold 24h change: ${inputs.goldChangePct > 0 ? "+" : ""}${inputs.goldChangePct.toFixed(2)}% (safe-haven flows ${inputs.goldChangePct > 0 ? "up" : "down"})`,
  });
  available++;

  components.push({
    label: "High-beta currencies",
    contribution: clampContribution(inputs.highBetaFxChangePct * 3.5),
    detail: `High-beta FX (e.g. AUD, NZD) average 24h change: ${inputs.highBetaFxChangePct.toFixed(2)}%`,
  });
  available++;

  components.push({
    label: "Bitcoin",
    contribution: clampContribution(inputs.btcChangePct * 1.4),
    detail: `Bitcoin 24h change: ${inputs.btcChangePct > 0 ? "+" : ""}${inputs.btcChangePct.toFixed(2)}%`,
  });
  available++;

  if (inputs.creditSpread !== null) {
    components.push({
      label: "Credit spreads",
      contribution: clampContribution((1.6 - inputs.creditSpread) * 6),
      detail: `High-yield credit spread at ${inputs.creditSpread.toFixed(2)}%`,
    });
    available++;
  } else {
    components.push({ label: "Credit spreads", contribution: 0, detail: "Data temporarily unavailable" });
  }

  const raw = components.reduce((s, c) => s + c.contribution, 0);
  const value = Math.round(Math.max(0, Math.min(100, 50 + raw)));

  return {
    value,
    label: classifyRiskGauge(value),
    components,
    history: [],
    componentsAvailable: available,
    componentsTotal: total,
  };
}

export { DEFAULT_RISK_GAUGE_BANDS };
