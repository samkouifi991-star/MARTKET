// Gold's V2 asset-specific interpretation. The continuous macro composite
// (real yields, USD, Fed-cut expectations, VIX, breakeven inflation — real
// yields and USD dominant) was already built for V1 in
// pipeline/gold-macro.ts's scoreGoldMacroRegime/computeGoldMacroRegime —
// V2 reuses that directly rather than reimplementing it (see engine.ts,
// a later milestone, for the wiring). This module adds the piece V1 never
// had: translating a DETECTED ECONOMIC SURPRISE (from economic-surprise.ts)
// into gold's initial event-shock contribution, per the spec's explicit
// Gold interpretation rules:
//   - stronger growth/labor surprise -> usually MILD bearish (small scale)
//   - hot inflation surprise -> initially bullish (the market's first-order
//     inflation-hedge read); the SLOWER-moving real-yield/USD composite
//     above is what ultimately confirms or reverses this once real yields
//     actually react — exactly the "if the market reverses ... the event
//     shock decays" mechanism the spec describes, not something this
//     module tries to fully resolve itself.
//   - a hawkish rate-decision surprise -> bearish (opposite of the raw
//     central-bank-event.ts convention, which is currency-generic); a
//     dovish/bullish-for-markets guidance read stays bullish for gold too,
//     since dovish guidance is bullish for both risk assets and gold alike.
import { EconomicIndicatorKey, indicatorCategory } from "@/services/economic-calendar/indicator-taxonomy";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// Inflation surprises get a larger initial shock than growth/labor ones —
// "usually mild bearish" for growth/labor per the spec, vs. inflation being
// one of gold's most direct drivers.
const INFLATION_SHOCK_SCALE = 1.2;
const GROWTH_LABOR_SHOCK_SCALE = 0.4;

/** Returns the SIGNED initial shock contribution (before importance-tier
 * scaling — see event-shock.ts) for a detected surprise on `indicatorKey`,
 * or null when this indicator isn't one gold's surprise-shock model reacts
 * to directly (e.g. a housing release, or a rate decision — handled
 * separately via goldRateDecisionShock) — a null result should never
 * create a shock, not default to zero-and-still-record-one. */
export function computeGoldSurpriseShock(indicatorKey: EconomicIndicatorKey, surpriseZ: number): number | null {
  const category = indicatorCategory(indicatorKey);
  if (category === "inflation") {
    // Hot inflation (positive surprise) -> initially bullish for gold's
    // inflation-hedge motive. Cold inflation -> initially bearish.
    return clamp(surpriseZ * INFLATION_SHOCK_SCALE);
  }
  if (category === "growthLabor") {
    // Strong growth/labor (positive surprise) -> mild bearish for gold
    // (higher real yields, reduced safe-haven demand) — the same polarity
    // flip pipeline/asset-polarity.ts already applies to the slow-moving
    // FRED-driven factor, mirrored here for the fast-moving surprise shock.
    return clamp(-surpriseZ * GROWTH_LABOR_SHOCK_SCALE);
  }
  return null;
}

/** Gold-specific sign convention for a central bank rate decision: a
 * hawkish surprise (actual rate above expected — computeRateDecisionShock
 * returns positive) is BEARISH for gold, the opposite of the generic
 * currency-strength convention central-bank-event.ts uses. */
export function goldRateDecisionShock(genericRateDecisionShock: number): number {
  return -genericRateDecisionShock;
}

/** Forward guidance is reused as-is (no sign flip): dovish/bullish-for-
 * risk-assets guidance is bullish for gold too, since both react the same
 * direction to looser expected policy. */
export function goldForwardGuidanceShock(genericForwardGuidanceShock: number): number {
  return genericForwardGuidanceShock;
}
