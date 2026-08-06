import { RiskGaugeComponent, RiskGaugeData } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";
import { classifyRiskGauge } from "../config";
import { generatePriceData } from "./price";
import { INVESTOR_SENTIMENT } from "./investorSentiment";
import { getInstrument } from "../instruments";

function pctChange(symbol: string): number {
  const inst = getInstrument(symbol);
  if (!inst) return 0;
  return generatePriceData(inst).changePct24h;
}

function buildComponents(): RiskGaugeComponent[] {
  const spx = pctChange("SPX500");
  const jpy = -pctChange("USDJPY"); // yen strength = USDJPY falling
  const chf = -pctChange("USDCHF");
  const gold = pctChange("XAUUSD");
  const aud = pctChange("AUDUSD");
  const nzd = pctChange("NZDUSD");
  const btc = pctChange("BTCUSD");
  const vix = INVESTOR_SENTIMENT.volatilityIndex;
  const creditSpread = INVESTOR_SENTIMENT.creditSpread;

  const components: RiskGaugeComponent[] = [
    { label: "Equity index performance", contribution: clamp(spx * 3), detail: `S&P 500 24h change: ${spx.toFixed(2)}%` },
    { label: "Volatility index (VIX)", contribution: clamp((18 - vix) * 1.6), detail: `VIX at ${vix.toFixed(1)}, ${vix < 16 ? "below" : vix > 22 ? "above" : "near"} its calm-market range` },
    { label: "Credit spreads", contribution: clamp((1.6 - creditSpread) * 6), detail: `High-yield spread at ${creditSpread.toFixed(2)}%` },
    { label: "Japanese yen", contribution: clamp(jpy * 3.5), detail: `USD/JPY 24h change implies yen ${jpy > 0 ? "weakening (risk-on funding flows)" : "strengthening (safe-haven demand)"}` },
    { label: "Swiss franc", contribution: clamp(chf * 3.5), detail: `USD/CHF 24h change implies franc ${chf > 0 ? "weakening" : "strengthening (safe-haven demand)"}` },
    { label: "Gold", contribution: clamp(-gold * 2.4), detail: `Gold 24h change: ${gold.toFixed(2)}% (safe-haven flows ${gold > 0 ? "up" : "down"})` },
    { label: "High-beta currencies (AUD, NZD)", contribution: clamp(((aud + nzd) / 2) * 3.5), detail: `AUD/NZD average 24h change: ${((aud + nzd) / 2).toFixed(2)}%` },
    { label: "Bitcoin", contribution: clamp(btc * 1.4), detail: `Bitcoin 24h change: ${btc.toFixed(2)}%` },
    { label: "Market breadth", contribution: clamp(spx > 0 ? spx * 2.2 : spx * 2.2), detail: "Advancing vs. declining issues proxy derived from index momentum" },
  ];
  return components;
}

function clamp(v: number, max = 20): number {
  return Math.max(-max, Math.min(max, v));
}

export function generateRiskGauge(): RiskGaugeData {
  const components = buildComponents();
  const raw = components.reduce((s, c) => s + c.contribution, 0);
  const value = Math.round(Math.min(100, Math.max(0, 50 + raw)));

  const rng = new Rng("risk-gauge-history");
  const history: { date: string; value: number }[] = [];
  let walk = value;
  for (let i = 89; i >= 0; i--) {
    walk += rng.float(-3, 3);
    walk = Math.min(95, Math.max(5, walk));
    history.push({ date: new Date(NOW.getTime() - i * 86_400_000).toISOString(), value: Math.round(walk) });
  }
  history[history.length - 1] = { date: history[history.length - 1].date, value };

  return { value, label: classifyRiskGauge(value), components, history };
}
