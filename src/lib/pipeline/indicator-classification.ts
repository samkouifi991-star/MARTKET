// Per-indicator (not per-country-composite) Bullish/Bearish/Neutral badge
// for the market-scorecard's Economic Growth/Inflation/Jobs Market rows —
// display-only, never fed back into score.factors or any V1/V2 write path.
//
// Deliberately reuses the SAME asset-specific polarity model already
// governing the real economicGrowth/labor factors (growthLaborPolarity,
// asset-polarity.ts) rather than inventing new per-asset interpretation
// logic — a stronger-than-forecast US jobs report reads Bearish for gold
// here for exactly the reason macro.ts's real factor already treats a
// stronger US economy as a headwind for gold (higher real yields, reduced
// safe-haven demand), just applied per-release instead of per-country-
// composite. Inflation uses a fixed +1 polarity, matching both V1's own
// generic macro.ts path (inflation is never asset-polarity-flipped there)
// and Gold's own bypassed model (asset-interpretation/gold.ts's
// computeGoldSurpriseShock: hot inflation reads bullish for gold too).
import { Instrument } from "@/lib/types";
import { EconomicIndicatorKey, indicatorCategory } from "@/services/economic-calendar/indicator-taxonomy";
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { growthLaborPolarity, macroPolarityClassFor } from "./asset-polarity";

export type IndicatorClassification = "Bullish" | "Bearish" | "Neutral";

// Indicators where a HIGHER actual than forecast is economically WEAKER
// news, not stronger — indicatorCategory() alone doesn't encode this (it
// only tracks inflation vs. growthLabor vs. rateDecision), so it's
// captured here as the one small piece of domain knowledge this module
// adds. Every other growthLabor indicator (gdp, nfp, retailSales, pmis,
// adpEmployment, jolts, avgHourlyEarnings, ...) is "higher is stronger".
const HIGHER_IS_WEAKER: ReadonlySet<EconomicIndicatorKey> = new Set(["unemploymentRate", "joblessClaims", "continuingClaims"]);

const INFLATION_POLARITY = 1;

// indicator-taxonomy.ts's indicatorCategory() classifies consumerConfidence/
// michiganSentiment as "other" — correct for V2's shock-dispatch purposes
// (engine.ts doesn't fire a direct shock for them), but for THIS module's
// narrower purpose — is a stronger-than-forecast print good or bad news
// for the economy — both are genuinely growth-sentiment reads (a beat
// means consumers/households are more confident, same direction as a GDP
// or retail-sales beat). Treated as growthLabor here only; V2's own
// categorization is untouched.
const GROWTH_LIKE_EXTRA: ReadonlySet<EconomicIndicatorKey> = new Set(["consumerConfidence", "michiganSentiment"]);

function classificationCategory(indicatorKey: EconomicIndicatorKey): "growthLabor" | "inflation" | null {
  const category = indicatorCategory(indicatorKey);
  if (category === "growthLabor" || category === "inflation") return category;
  if (GROWTH_LIKE_EXTRA.has(indicatorKey)) return "growthLabor";
  return null;
}

/**
 * Returns null — never a fabricated badge — when `forecast` is null: there
 * is no real surprise to classify, matching the same "do not fabricate
 * forecast/surprise" rule applied to the Actual/Forecast/Surprise columns
 * themselves. `actual`/`forecast` are always real stored values from
 * economicEvents (FMP calendar) or economicReleaseSurprises (V2) — this
 * function performs no I/O and never invents either input.
 */
export function classifyIndicatorSurprise(instrument: Instrument, indicatorKey: EconomicIndicatorKey, actual: number | null, forecast: number | null): IndicatorClassification | null {
  if (actual === null || forecast === null) return null;

  const category = classificationCategory(indicatorKey);
  if (category === null) return null;

  const rawSurpriseSign = Math.sign(actual - forecast);
  const economicStrengthSign = HIGHER_IS_WEAKER.has(indicatorKey) ? -rawSurpriseSign : rawSurpriseSign;

  const polarity = category === "inflation" ? INFLATION_POLARITY : growthLaborPolarity(instrument);
  const assetSign = economicStrengthSign * polarity;

  if (assetSign > 0) return "Bullish";
  if (assetSign < 0) return "Bearish";
  return "Neutral";
}

export type MacroTrendKind = "growth" | "inflation" | "jobs";

/**
 * Same polarity model as classifyIndicatorSurprise above, applied to a
 * period-over-period CHANGE in a raw FRED series level instead of an
 * actual-vs-forecast surprise — used only by the scorecard's Macro State
 * fallback (lib/pipeline/scorecard.ts), for when no calendar release
 * exists to compare against a forecast at all. `change` is the raw,
 * unflipped change in the series' own value (e.g. macro-differential.ts's
 * scoreIndicator().changeAbs) — positive means the series level itself
 * rose, never pre-flipped by the caller. "jobs" here always means
 * unemploymentRate, where a rise is weaker (mirrors HIGHER_IS_WEAKER
 * above); "growth" (gdpGrowth) and "inflation" (cpi) both read a rise as
 * stronger/hotter before polarity is applied.
 */
export function classifyMacroTrend(instrument: Instrument, kind: MacroTrendKind, change: number): IndicatorClassification {
  if (change === 0) return "Neutral";

  const rawSign = Math.sign(change);
  const economicStrengthSign = kind === "jobs" ? -rawSign : rawSign;
  const polarity = kind === "inflation" ? INFLATION_POLARITY : growthLaborPolarity(instrument);
  const assetSign = economicStrengthSign * polarity;

  if (assetSign > 0) return "Bullish";
  if (assetSign < 0) return "Bearish";
  return "Neutral";
}

/**
 * Display-only hawkish/dovish read of a central-bank rate DECISION (never a
 * V1/V2 score input — see scorecard.ts's resolveRateDecisionRows, the only
 * caller). A rate decision has no "beat = stronger economy" reading the way
 * a growth/inflation release does: the deterministic rule here is simply
 * actual > forecast = hawkish, actual < forecast = dovish, actual ===
 * forecast = Neutral, forecast missing = null (rendered "Unavailable" —
 * never guessed). That hawkish/dovish read is then translated per asset
 * class:
 *  - FX: hawkish BASE currency -> pair Bullish, dovish base -> Bearish;
 *    hawkish QUOTE currency flips (a stronger quote currency weakens the
 *    pair) -> Bearish, dovish quote -> Bullish. `country` identifies which
 *    side of the pair this specific release belongs to.
 *  - Precious metals (Gold/Silver/Platinum): hawkish Fed -> Bearish (higher
 *    real-yield expectations, reduced safe-haven demand), dovish -> Bullish.
 *  - US equity indices / crypto: hawkish Fed -> Bearish, dovish -> Bullish
 *    (the same direction as gold's regime read, just a softer "risk
 *    sentiment" transmission than gold's real-yield one — still rendered
 *    with the same three-value badge, no separate "conservative" tier).
 *  - Anything else (e.g. generic commodities): no established model here,
 *    so null rather than a guess.
 */
export function classifyRateDecisionBias(instrument: Instrument, country: string, actual: number, forecast: number | null): IndicatorClassification | null {
  if (forecast === null) return null;

  const hawkishSign = Math.sign(actual - forecast);
  if (hawkishSign === 0) return "Neutral";

  if (instrument.currencies) {
    const baseCountry = CCY_TO_COUNTRY[instrument.currencies[0]];
    const quoteCountry = CCY_TO_COUNTRY[instrument.currencies[1]];
    let assetSign: number;
    if (country === baseCountry) assetSign = hawkishSign;
    else if (country === quoteCountry) assetSign = -hawkishSign;
    else return null; // this release isn't for either side of the pair
    return assetSign > 0 ? "Bullish" : "Bearish";
  }

  const polarityClass = macroPolarityClassFor(instrument);
  if (polarityClass === "PreciousMetals" || polarityClass === "EquityIndices" || polarityClass === "Crypto") {
    return hawkishSign > 0 ? "Bearish" : "Bullish";
  }

  return null;
}
