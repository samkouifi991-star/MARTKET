import { Rng } from "../rng";
import { getInstrument } from "../instruments";
import { getEconomy } from "./economies";
import { getCentralBankByCurrency } from "./centralBanks";

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

const CCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  JPY: "JP",
  CHF: "CH",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
};

// Derives an expected directional lean from the same underlying macro data the
// scoring engine reads (rate differentials, policy stance, growth), so price
// trend, institutional positioning and retail flow aren't generated as pure
// noise independent of fundamentals — mirroring how real markets are driven
// by the same macro forces the platform scores.
function fundamentalLean(symbol: string): number {
  const instrument = getInstrument(symbol);
  if (!instrument) return 0;

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const baseCb = getCentralBankByCurrency(base);
    const quoteCb = getCentralBankByCurrency(quote);
    const baseEco = getEconomy(CCY_TO_COUNTRY[base]);
    const quoteEco = getEconomy(CCY_TO_COUNTRY[quote]);
    const rateDiff = (baseCb.currentRate - quoteCb.currentRate) / 3;
    const stanceDiff = (baseCb.stanceScore - quoteCb.stanceScore) / 10;
    const growthDiff = (baseEco.growthScore - quoteEco.growthScore) / 10;
    return clamp(rateDiff * 0.4 + stanceDiff * 0.35 + growthDiff * 0.25);
  }

  const usCb = getCentralBankByCurrency("USD");
  const usEco = getEconomy("US");

  if (instrument.assetClass === "Indices") {
    return clamp((-usCb.stanceScore / 10) * 0.6 + (usEco.growthScore / 10) * 0.4);
  }
  if (instrument.symbol === "XAUUSD" || instrument.symbol === "XAGUSD" || instrument.symbol === "XPTUSD") {
    return clamp((-usCb.stanceScore / 10) * 0.7 + (usEco.inflationScore / 10) * 0.3);
  }
  if (instrument.assetClass === "Commodities") {
    return clamp((usEco.growthScore / 10) * 0.7 + (-usCb.stanceScore / 10) * 0.3);
  }
  // Crypto trades more on liquidity/risk appetite than direct fundamentals,
  // so it keeps a smaller fundamental weighting relative to its own randomness.
  return clamp((-usCb.stanceScore / 10) * 0.5);
}

export function instrumentRegime(symbol: string): number {
  const rng = new Rng(`regime:${symbol}`);
  const fundamental = fundamentalLean(symbol);
  const random = rng.float(-1, 1);
  const fundamentalWeight = 0.55;
  const blended = fundamental * fundamentalWeight + random * (1 - fundamentalWeight);
  // Push mid-range values toward the extremes so trends read clearly in the
  // demo instead of clustering near zero — direction is preserved exactly.
  const shaped = Math.sign(blended) * Math.pow(Math.abs(blended), 0.7);
  return clamp(shaped, -0.97, 0.97);
}
