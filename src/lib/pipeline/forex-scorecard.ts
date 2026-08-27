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
  dailyTrend: TrendLabel | null;
  h4Trend: TrendLabel | null;
  h1Trend: TrendLabel | null;
  technicalFreshness: DataFreshness | null;
  retail: { pctLong: number; pctShort: number; contrarianBias: TrendLabel } | null;
  finalScore: number | null; // this pair's real canonical V1 score — not a new blended number
  finalBias: Bias | null;
};

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
    getCurrentScore(symbol),
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
    dailyTrend: dailyScore !== null ? trendLabel(dailyScore) : null,
    h4Trend: h4Score !== null ? trendLabel(h4Score) : null,
    h1Trend: h1Score !== null ? trendLabel(h1Score) : null,
    technicalFreshness: techFetch.result ? techFetch.daily.status : null,
    retail,
    finalScore: currentScore?.totalScore ?? null,
    finalBias: currentScore?.bias ?? null,
  };
}

export async function buildAllForexScorecards(storageOnly = true): Promise<ForexScorecardData[]> {
  return Promise.all(FX_PAIRS.map((symbol) => buildForexScorecard(symbol, storageOnly)));
}
