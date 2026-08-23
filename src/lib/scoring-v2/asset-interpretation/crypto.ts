// Crypto's V2 asset-specific interpretation (requirement #5's Crypto
// section): emphasize global liquidity, real yields, USD, monetary policy,
// and risk appetite — the same regime read Gold and Indices consume (see
// regime.ts), but crypto reacts like a high-beta risk asset to it rather
// than a safe haven. GDP/labor surprises should mostly matter through
// their effect on liquidity/rates expectations, not be scored directly
// with real weight of their own — hence the deliberately small direct
// scale below.
import { MacroRegime } from "../regime";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

const REGIME_SHOCK: Record<MacroRegime, number> = {
  DovishEasing: 2.0, // loosening liquidity conditions are strongly bullish for crypto
  HawkishTightening: -2.0,
  RiskOn: 1.2,
  RiskOff: -1.2,
  Neutral: 0,
};

/** A pure regime-driven shock — no surprise input needed, since the regime
 * itself (real yields, USD, VIX) IS the dominant crypto driver per the
 * spec, not any single release. */
export function computeCryptoRegimeShock(regime: MacroRegime): number {
  return REGIME_SHOCK[regime];
}

// Deliberately small — GDP/labor should mostly matter through their effect
// on liquidity/rates expectations (captured by the regime shock above),
// not stand alone as a meaningful direct driver of crypto's score.
const GROWTH_LABOR_DIRECT_SCALE = 0.3;

export function computeCryptoGrowthLaborShock(surpriseZ: number, scale = GROWTH_LABOR_DIRECT_SCALE): number {
  return clamp(surpriseZ * scale);
}
