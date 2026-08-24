// Live-aware Risk-On/Risk-Off gauge — Phase 18 (public-launch demo sweep):
// lib/engines/risk-gauge.ts's computeRiskGauge was built with real-signal
// inputs in mind (6 required, 3 explicitly nullable — see its own type) but
// was never actually wired to a live source anywhere; both the Dashboard
// card and the dedicated /risk-gauge page called the pure demo generator
// unconditionally. This wires the 6 required components to the SAME
// canonical, storage-first quote resolver every other public surface uses
// (no new provider — every symbol below is already a STRICT_LIVE_SYMBOL),
// and honestly leaves the 3 components with no live source in this codebase
// (volatility index, yield-curve slope change, credit spread) as
// "unavailable" via the engine's own existing null-input path, rather than
// fabricating them.
import { computeRiskGauge, RiskGaugeInputs } from "@/lib/engines/risk-gauge";
import { RiskGaugeData } from "@/lib/types";
import { getQuoteWithFallback } from "@/services/market-data/last-known-good";
import { isUsable } from "./types";

const REQUIRED_SYMBOLS = {
  equityIndex: "SPX500",
  jpy: "USDJPY",
  chf: "USDCHF",
  gold: "XAUUSD",
  aud: "AUDUSD",
  nzd: "NZDUSD",
  btc: "BTCUSD",
} as const;

async function changePct(symbol: string): Promise<number | null> {
  const q = await getQuoteWithFallback(symbol, true);
  return isUsable(q.status, q.value) ? q.value!.changePct24h : null;
}

export type LiveRiskGaugeResult = (RiskGaugeData & { componentsAvailable: number; componentsTotal: number }) | null;

export async function getLiveRiskGauge(): Promise<{ result: LiveRiskGaugeResult; unavailableReason: string | null }> {
  const [equityIndex, jpy, chf, gold, aud, nzd, btc] = await Promise.all(Object.values(REQUIRED_SYMBOLS).map(changePct));

  const missing = [
    equityIndex === null && "equity index (SPX500)",
    jpy === null && "USD/JPY",
    chf === null && "USD/CHF",
    gold === null && "gold (XAU/USD)",
    (aud === null || nzd === null) && "high-beta FX (AUD, NZD)",
    btc === null && "Bitcoin",
  ].filter((v): v is string => v !== false);

  if (missing.length > 0) {
    return { result: null, unavailableReason: `Real quote data currently unavailable for: ${missing.join(", ")}.` };
  }

  const inputs: RiskGaugeInputs = {
    equityIndexChangePct: equityIndex!,
    volatilityIndexLevel: null, // no volatility-index (VIX) provider in the current provider set
    volatilityIndexAvg: 0,
    yieldCurveSlopeChangeBp: null, // no live day-over-day yield-curve-slope feed in the current provider set
    usdJpyChangePct: jpy!,
    usdChfChangePct: chf!,
    goldChangePct: gold!,
    highBetaFxChangePct: (aud! + nzd!) / 2,
    btcChangePct: btc!,
    creditSpread: null, // no credit-spread provider in the current provider set
  };

  return { result: computeRiskGauge(inputs), unavailableReason: null };
}
