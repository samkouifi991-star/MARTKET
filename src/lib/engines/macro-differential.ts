// Macro differential engine — scores a country's economic trajectory from
// real FRED time series (never the raw level alone), then, for FX pairs,
// differentials one country's score against another's. Growth improving
// faster than the counter-currency's growth is bullish for the pair; if the
// counter-currency's data is improving faster, that's bearish — exactly the
// GBP-vs-USD example in the spec.
import { FredSeriesPoint } from "@/services/types";
import { FredIndicatorKey } from "@/services/market-data/fred-series";

export type Trend = "Improving" | "Deteriorating" | "Stable";
export type Acceleration = "Accelerating" | "Decelerating" | "Stable";

export type IndicatorScore = {
  indicator: FredIndicatorKey;
  currentValue: number;
  previousValue: number;
  changeAbs: number;
  changePct: number | null;
  trend: Trend;
  acceleration: Acceleration;
  rawScore: number; // -10..10, already sign-adjusted for higherIsBetter
  surpriseAdjustment: number; // 0 unless applySurprise() was folded in
};

// Whether a rising value is the economically favorable direction.
export const HIGHER_IS_BETTER: Record<FredIndicatorKey, boolean> = {
  realGdp: true,
  gdpGrowth: true,
  industrialProduction: true,
  retailSales: true,
  cpi: true,
  coreCpi: true,
  pce: true,
  corePce: true,
  ppi: true,
  unemploymentRate: false,
  payrolls: true,
  initialClaims: false,
  wageGrowth: true,
  laborParticipation: true,
  policyRate: true,
  yield2y: true,
  yield10y: true,
  // Not consumed by scoreIndicator()/computeCountryMacroScores() — these 4
  // feed pipeline/gold-macro.ts's own composite directly (it reads raw
  // change, not a HIGHER_IS_BETTER-signed z-score), never a country
  // differential. Present only so this Record<FredIndicatorKey, ...> stays
  // exhaustive; values are unused for these keys.
  realYield10y: true,
  breakevenInflation10y: true,
  usdIndexBroad: true,
  vix: false,
};

const INDICATOR_CATEGORY: Record<FredIndicatorKey, "growth" | "inflation" | "labor" | "rates"> = {
  realGdp: "growth",
  gdpGrowth: "growth",
  industrialProduction: "growth",
  retailSales: "growth",
  cpi: "inflation",
  coreCpi: "inflation",
  pce: "inflation",
  corePce: "inflation",
  ppi: "inflation",
  unemploymentRate: "labor",
  payrolls: "labor",
  initialClaims: "labor",
  wageGrowth: "labor",
  laborParticipation: "labor",
  policyRate: "rates",
  yield2y: "rates",
  yield10y: "rates",
  // Unused for these 4 (see HIGHER_IS_BETTER's comment above) — present
  // only for exhaustiveness.
  realYield10y: "rates",
  breakevenInflation10y: "inflation",
  usdIndexBroad: "rates",
  vix: "rates",
};

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** points must be sorted oldest-first (matches FRED client's convention). */
export function scoreIndicator(indicator: FredIndicatorKey, points: FredSeriesPoint[]): IndicatorScore | null {
  if (points.length < 3) return null; // need at least 3 observations to judge acceleration

  const values = points.map((p) => p.value);
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1]);

  const current = values[values.length - 1];
  const previous = values[values.length - 2];
  const changeAbs = current - previous;
  const changePct = previous !== 0 ? (changeAbs / Math.abs(previous)) * 100 : null;

  const direction = HIGHER_IS_BETTER[indicator] ? 1 : -1;
  const changeStd = stdDev(changes.slice(0, -1)); // historical volatility, excludes the most recent change itself
  // When prior changes have (near) zero variance, a z-score is undefined —
  // fall back to a fixed moderate signal rather than silently reporting "no move".
  const z = changeStd > 1e-9 ? changeAbs / changeStd : Math.sign(changeAbs) * 2;
  const rawScore = clamp(z * direction * 3);

  const trend: Trend = Math.abs(changeAbs) < changeStd * 0.15 ? "Stable" : changeAbs * direction > 0 ? "Improving" : "Deteriorating";

  const priorChange = changes[changes.length - 2] ?? 0;
  let acceleration: Acceleration = "Stable";
  if (Math.sign(changeAbs) === Math.sign(priorChange) && Math.sign(changeAbs) !== 0) {
    acceleration = Math.abs(changeAbs) > Math.abs(priorChange) ? "Accelerating" : "Decelerating";
  }

  return { indicator, currentValue: current, previousValue: previous, changeAbs, changePct, trend, acceleration, rawScore, surpriseAdjustment: 0 };
}

/** Optional: nudge an already-computed indicator score using an FMP economic-calendar
 * actual-vs-forecast surprise for the same release, when one is available. */
export function applySurprise(score: IndicatorScore, actual: number, forecast: number): IndicatorScore {
  const direction = HIGHER_IS_BETTER[score.indicator] ? 1 : -1;
  const surpriseAdjustment = clamp(((actual - forecast) / (Math.abs(forecast) || 1)) * direction * 20, -2, 2);
  return { ...score, surpriseAdjustment, rawScore: clamp(score.rawScore + surpriseAdjustment) };
}

export type CountryMacroScores = {
  growthScore: number | null;
  inflationScore: number | null;
  laborScore: number | null;
  indicators: IndicatorScore[];
};

export function computeCountryMacroScores(seriesByIndicator: Partial<Record<FredIndicatorKey, FredSeriesPoint[]>>): CountryMacroScores {
  const indicators: IndicatorScore[] = [];
  for (const [key, points] of Object.entries(seriesByIndicator) as [FredIndicatorKey, FredSeriesPoint[]][]) {
    const score = scoreIndicator(key, points);
    if (score) indicators.push(score);
  }

  function averageFor(category: "growth" | "inflation" | "labor"): number | null {
    const matching = indicators.filter((s) => INDICATOR_CATEGORY[s.indicator] === category);
    if (matching.length === 0) return null;
    return Number((matching.reduce((sum, s) => sum + s.rawScore, 0) / matching.length).toFixed(2));
  }

  return {
    growthScore: averageFor("growth"),
    inflationScore: averageFor("inflation"),
    laborScore: averageFor("labor"),
    indicators,
  };
}

/** Positive = favors the base currency (first in the pair); negative = favors the quote currency. */
export function computeFxDifferential(baseScore: number | null, quoteScore: number | null): number | null {
  if (baseScore === null || quoteScore === null) return null;
  return clamp(baseScore - quoteScore);
}
