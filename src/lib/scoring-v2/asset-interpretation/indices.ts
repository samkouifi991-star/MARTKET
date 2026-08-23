// Equity indices' V2 asset-specific interpretation (requirement #5's
// Indices section): a growth surprise needs REGIME-DEPENDENT
// interpretation, not a blanket "strong growth = bullish equities". Strong
// growth is bullish unless it feeds hotter inflation, higher yields, and
// more Fed tightening (a HawkishTightening regime) — in which case the
// same "good news" becomes a headwind via the rates/valuation channel.
import { MacroRegime } from "../regime";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

const BASE_GROWTH_SHOCK_SCALE = 1.5;

// In a hawkish-tightening regime, a strong growth surprise is dampened and
// partially inverted — the same data that would normally be bullish is
// instead read as fueling more tightening. In risk-off, growth data is
// muted entirely; the regime itself dominates. Risk-on and neutral regimes
// keep the standard "strong growth is bullish" reading.
const REGIME_MULTIPLIER: Record<MacroRegime, number> = {
  HawkishTightening: -0.5,
  DovishEasing: 1.2, // growth surprises are extra-welcome when policy is already easing
  RiskOff: 0.3,
  RiskOn: 1.1,
  Neutral: 1.0,
};

/** growthSurpriseZ is the relevant country's growth-release surprise
 * z-score (GDP, ISM, retail sales, etc. — whichever triggered this cycle);
 * regime is the shared macro-regime read from regime.ts, computed from the
 * SAME real-yield/USD/VIX inputs Gold's composite uses, so equities and
 * Gold never silently disagree about what regime the market is in even
 * though they react to it oppositely. */
export function computeIndicesGrowthShock(growthSurpriseZ: number, regime: MacroRegime, scale = BASE_GROWTH_SHOCK_SCALE): number {
  return clamp(growthSurpriseZ * scale * REGIME_MULTIPLIER[regime]);
}

/** Inflation surprises for equities: cooler-than-expected inflation is
 * bullish (less tightening pressure); hotter-than-expected is bearish —
 * the opposite polarity from Gold's inflation-hedge read, and NOT
 * regime-gated the way growth is (an inflation surprise IS the thing that
 * would change the regime, so gating it by the pre-existing regime would
 * double-count). */
export function computeIndicesInflationShock(inflationSurpriseZ: number, scale = 1.0): number {
  return clamp(-inflationSurpriseZ * scale);
}
