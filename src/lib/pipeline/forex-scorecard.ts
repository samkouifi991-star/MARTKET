// Forex Scorecard (Phase 5 of the platform redesign) — per the plan,
// intended to become one of this product's strongest features: for each
// tracked FX pair, base/quote Economic Strength (Phase 4) + differential,
// base/quote policy rate + differential, economic-surprise differential,
// Daily/4H/1H technical-trend labels, retail sentiment, and the pair's
// real canonical (V1) score — composed entirely from already-verified
// building blocks, no new scoring math for the final score itself.
import { INSTRUMENTS } from "@/lib/instruments";
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { computeCurrencyStrength, surpriseRollupFor, CurrencyStrength } from "./economic-strength";
import { fetchLatestRates } from "./macro";
import { fetchTechnicalTrend } from "./technical";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";
import { getRetailSentimentFromStorage } from "@/services/market-data/last-known-good";
import { getCurrentScore } from "@/db/queries/scores";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "@/lib/config";
import { Bias, DataFreshness } from "@/lib/types";
import { bandByThresholds, bandHeatmapValue, HeatmapLabel } from "./economic-heatmap";

export type TrendLabel = "Bullish" | "Bearish" | "Neutral";

export const FX_PAIRS: string[] = INSTRUMENTS.filter((i) => i.assetClass === "Forex" && i.currencies).map((i) => i.symbol);

export type ForexScorecardData = {
  symbol: string;
  base: string;
  quote: string;
  baseStrength: CurrencyStrength;
  quoteStrength: CurrencyStrength;
  strengthDifferential: number | null; // baseStrength.score - quoteStrength.score, -200..200
  baseRate: number | null;
  quoteRate: number | null;
  rateDifferentialPts: number | null;
  surpriseDifferential: number | null; // base country surprise rollup minus quote's, -10..10-ish
  baseSurprise: number | null;
  quoteSurprise: number | null;
  dailyTrend: TrendLabel | null;
  h4Trend: TrendLabel | null;
  h1Trend: TrendLabel | null;
  technicalFreshness: DataFreshness | null;
  retail: { pctLong: number; pctShort: number; contrarianBias: TrendLabel } | null;
  finalScore: number | null; // this pair's real canonical V1 score — not a new blended number
  finalBias: Bias | null;
  // Pre-launch value pass: presentation-only 5-tier bands over the three
  // differentials above, reusing the exact color language Economic Heatmap
  // already established (see economic-heatmap.ts's HEATMAP_LABEL_CLASSES)
  // so "bullish/bearish at a glance" reads the same everywhere in the app.
  // null whenever the underlying differential itself is null.
  strengthBand: HeatmapLabel | null;
  rateBand: HeatmapLabel | null;
  surpriseBand: HeatmapLabel | null;
  // One deterministic sentence combining the differentials/trend/retail
  // already computed above — see synthesizeForexNarrative. Never an LLM
  // call: every clause is a direct, literal readout of a field already on
  // this object, so it can never say something the data doesn't support.
  narrative: string | null;
};

// Differential-specific thresholds, each picked from that field's own real
// range (documented per field) rather than reusing bandHeatmapValue's ±1/±4
// (tuned for the -10..10 factor-score scale) — applying that scale to e.g.
// a -200..200 strength differential would trivially band everything as
// "Strong". Surprise differential IS already on that -10-ish scale, so it
// reuses bandHeatmapValue directly.
export function bandStrengthDifferential(value: number | null): HeatmapLabel | null {
  // Individual currency strength scores are -100..100 (see
  // economic-strength.ts's strengthLevelForScore: Strong >=20, Very
  // Strong >=60). A differential of two such scores is naturally wider;
  // 15/45 keeps the same rough proportions for "the gap itself is strong".
  return value === null ? null : bandByThresholds(value, 15, 45);
}

export function bandRateDifferential(value: number | null): HeatmapLabel | null {
  // Real policy-rate gaps among the 8 tracked economies typically run
  // 0..6pt; 0.75/2.5 keeps a genuinely small gap "Neutral" while a gap
  // like GBP 3.75% vs JPY 0.84% (2.91pt) reads as clearly bullish/strong.
  return value === null ? null : bandByThresholds(value, 0.75, 2.5);
}

export function bandSurpriseDifferential(value: number | null): HeatmapLabel | null {
  return value === null ? null : bandHeatmapValue(value);
}

/** Combines fields already computed on `data` into one plain-English
 * sentence — every clause is a direct readout (band label / rate numbers /
 * trend label / retail %) of a real field, never a paraphrase or inference
 * beyond what those fields already say. Returns null when there isn't
 * enough real data to say anything (both strength scores and the rate
 * differential unavailable), matching this pipeline's existing
 * null-if-unavailable convention. */
export function synthesizeForexNarrative(data: Pick<ForexScorecardData, "base" | "quote" | "strengthDifferential" | "rateDifferentialPts" | "dailyTrend">): string | null {
  const { base, quote, strengthDifferential, rateDifferentialPts, dailyTrend } = data;
  if (strengthDifferential === null && rateDifferentialPts === null) return null;

  const clauses: string[] = [];
  if (strengthDifferential !== null) {
    const stronger = strengthDifferential > 0 ? base : strengthDifferential < 0 ? quote : null;
    clauses.push(stronger ? `${stronger} currently has stronger macro conditions` : `${base} and ${quote} have similar macro conditions`);
  }
  if (rateDifferentialPts !== null) {
    const favored = rateDifferentialPts > 0 ? base : rateDifferentialPts < 0 ? quote : null;
    clauses.push(favored ? `a favorable rate differential for ${favored}` : "no meaningful rate differential");
  }
  if (dailyTrend) {
    clauses.push(`the daily technical trend is ${dailyTrend.toLowerCase()}`);
  }
  if (clauses.length === 0) return null;
  const [first, ...rest] = clauses;
  return `${first}${rest.length > 0 ? `, with ${rest.join(", and ")}` : ""}.`;
}

/** "BULLISH GBPJPY" / "BEARISH GBPJPY" / "NEUTRAL" — a direct readout of an
 * already-computed band, named for the pair (not just the differential
 * number) since "the gap favors the base currency" is exactly what
 * "bullish <pair>" means in FX convention (long base, short quote). */
export function pairDirectionLabel(band: HeatmapLabel | null, base: string, quote: string): string {
  if (!band || band === "Neutral") return "NEUTRAL";
  return band.startsWith("Strong bullish") || band === "Bullish" ? `BULLISH ${base}${quote}` : `BEARISH ${base}${quote}`;
}

function trendLabel(score: number): TrendLabel {
  if (score > 0) return "Bullish";
  if (score < 0) return "Bearish";
  return "Neutral";
}

function round(v: number, decimals = 1): number {
  return Number(v.toFixed(decimals));
}

export async function buildForexScorecard(symbol: string, storageOnly = true): Promise<ForexScorecardData> {
  const instrument = INSTRUMENTS.find((i) => i.symbol === symbol);
  if (!instrument?.currencies) throw new Error(`${symbol} is not a tracked FX pair.`);
  const [base, quote] = instrument.currencies;
  const baseCountry = CCY_TO_COUNTRY[base];
  const quoteCountry = CCY_TO_COUNTRY[quote];

  const [baseStrength, quoteStrength, baseRateRead, quoteRateRead, surpriseRows, techFetch, retailRead, currentScore] = await Promise.all([
    computeCurrencyStrength(base, storageOnly),
    computeCurrencyStrength(quote, storageOnly),
    fetchLatestRates(baseCountry, storageOnly),
    fetchLatestRates(quoteCountry, storageOnly),
    getRecentSurprisesForCountries([baseCountry, quoteCountry]),
    fetchTechnicalTrend(symbol, storageOnly),
    getRetailSentimentFromStorage(symbol),
    getCurrentScore(symbol, { includeHistory: false }), // only finalScore/finalBias below ever read this
  ]);

  const strengthDifferential = baseStrength.score !== null && quoteStrength.score !== null ? round(baseStrength.score - quoteStrength.score) : null;
  const rateDifferentialPts = baseRateRead.policyRate !== null && quoteRateRead.policyRate !== null ? round(baseRateRead.policyRate - quoteRateRead.policyRate, 2) : null;

  const baseSurprise = surpriseRollupFor(baseCountry, surpriseRows);
  const quoteSurprise = surpriseRollupFor(quoteCountry, surpriseRows);
  // Same one-sided convention as fx.ts's computeFxRelativeSurpriseShockOneSided:
  // when only one side has a fresh surprise this cycle, the other side is
  // implicitly 0, not excluded from the differential entirely.
  const surpriseDifferential =
    baseSurprise !== null || quoteSurprise !== null ? round((baseSurprise ?? 0) - (quoteSurprise ?? 0), 2) : null;

  const timeframes = techFetch.result?.timeframes ?? [];
  const dailyScore = timeframes.find((t) => t.timeframe === "daily")?.score ?? null;
  const h4Score = timeframes.find((t) => t.timeframe === "4h")?.score ?? null;
  const h1Score = timeframes.find((t) => t.timeframe === "1h")?.score ?? null;

  let retail: ForexScorecardData["retail"] = null;
  const retailUsable = (retailRead.status === "live" || retailRead.status === "delayed" || retailRead.status === "stale") && retailRead.value;
  if (retailUsable && retailRead.value) {
    const { pctLong, pctShort } = retailRead.value;
    const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
    const contrarianBias: TrendLabel = pctLong > extremeLongThreshold ? "Bearish" : pctShort > extremeShortThreshold ? "Bullish" : "Neutral";
    retail = { pctLong, pctShort, contrarianBias };
  }

  const dailyTrend = dailyScore !== null ? trendLabel(dailyScore) : null;

  return {
    symbol,
    base,
    quote,
    baseStrength,
    quoteStrength,
    strengthDifferential,
    baseRate: baseRateRead.policyRate,
    quoteRate: quoteRateRead.policyRate,
    rateDifferentialPts,
    surpriseDifferential,
    baseSurprise,
    quoteSurprise,
    dailyTrend,
    h4Trend: h4Score !== null ? trendLabel(h4Score) : null,
    h1Trend: h1Score !== null ? trendLabel(h1Score) : null,
    technicalFreshness: techFetch.result ? techFetch.daily.status : null,
    retail,
    finalScore: currentScore?.totalScore ?? null,
    finalBias: currentScore?.bias ?? null,
    strengthBand: bandStrengthDifferential(strengthDifferential),
    rateBand: bandRateDifferential(rateDifferentialPts),
    surpriseBand: bandSurpriseDifferential(surpriseDifferential),
    narrative: synthesizeForexNarrative({ base, quote, strengthDifferential, rateDifferentialPts, dailyTrend }),
  };
}

export async function buildAllForexScorecards(storageOnly = true): Promise<ForexScorecardData[]> {
  return Promise.all(FX_PAIRS.map((symbol) => buildForexScorecard(symbol, storageOnly)));
}
