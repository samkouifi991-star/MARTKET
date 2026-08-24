import {
  DataFreshness,
  FACTOR_LABELS,
  Instrument,
  MarketScore,
  ScoreFactor,
  ScoreFactorKey,
  ScoreHistoryPoint,
} from "./types";
import { DEFAULT_FACTOR_WEIGHTS, DEFAULT_RETAIL_SENTIMENT_CONFIG, classifyBias } from "./config";
import { Rng } from "./rng";
import { NOW, daysAgo, isoOffset } from "./time";
import { generatePriceData } from "./demo/price";
import { generatePositioning } from "./demo/positioning";
import { generateRetailSentiment } from "./demo/retail";
import { getEconomy } from "./demo/economies";
import { CENTRAL_BANKS, getCentralBankByCurrency } from "./demo/centralBanks";
import { currentMonthStat } from "./demo/seasonality";
import { NEWS_ARTICLES } from "./demo/news";
import { growthLaborPolarity } from "./pipeline/asset-polarity";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// Symbols/factors intentionally seeded as demo edge cases (section 35):
// missing data and stale data must be visibly represented, not hidden.
const STALE_OVERRIDES: Partial<Record<string, ScoreFactorKey[]>> = {
  RUT2000: ["news"],
  NATGAS: ["institutional"],
};
const MISSING_OVERRIDES: Partial<Record<string, ScoreFactorKey[]>> = {
  XPTUSD: ["retailSentiment"],
};

function freshnessMeta(
  rng: Rng,
  symbol: string,
  key: ScoreFactorKey,
  cadenceHours: number
): { freshness: DataFreshness; lastUpdated: string; nextUpdate: string } {
  if (MISSING_OVERRIDES[symbol]?.includes(key)) {
    return { freshness: "estimated", lastUpdated: daysAgo(9), nextUpdate: isoOffset(24) };
  }
  if (STALE_OVERRIDES[symbol]?.includes(key)) {
    return { freshness: "stale", lastUpdated: daysAgo(6), nextUpdate: isoOffset(2) };
  }
  const lagHours = rng.float(0.1, cadenceHours * 0.6);
  return {
    freshness: lagHours > cadenceHours * 1.5 ? "delayed" : "live",
    lastUpdated: isoOffset(-lagHours),
    nextUpdate: isoOffset(cadenceHours - lagHours),
  };
}

function currencyPairInfo(instrument: Instrument): [string, string] | null {
  return instrument.currencies ?? null;
}

// ---- Factor computations -------------------------------------------------

export function institutionalFactor(instrument: Instrument) {
  const pos = generatePositioning(instrument);
  const skew = clamp(((pos.pctLong - 50) / 50) * 10);
  const momentum = clamp((pos.netWeeklyChange / Math.max(1, Math.abs(pos.netPositioning) || 1)) * 10);
  let raw = skew * 0.6 + momentum * 0.4;
  const extreme = pos.percentile >= 90 || pos.percentile <= 10;
  if (extreme) raw *= 0.5;
  raw = clamp(raw);

  let explanation = `Large speculators are ${pos.pctLong.toFixed(0)}% long / ${pos.pctShort.toFixed(0)}% short with a net weekly change of ${pos.netWeeklyChange > 0 ? "+" : ""}${pos.netWeeklyChange.toLocaleString()} contracts (${pos.percentile}th percentile vs. 3-year history).`;
  if (extreme) {
    explanation += ` Positioning is historically crowded, so the score is dampened for overcrowding / reversal risk rather than treated as automatically directional.`;
  }
  return { raw, explanation, source: "CFTC-style Commitment of Traders (weekly)", cadenceHours: 168 };
}

export function retailSentimentFactor(instrument: Instrument) {
  const retail = generateRetailSentiment(instrument);
  const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
  let raw = 0;
  let explanation = `Retail traders are ${retail.pctLong.toFixed(0)}% long / ${retail.pctShort.toFixed(0)}% short, within normal range — no contrarian signal generated.`;
  if (retail.pctLong > extremeLongThreshold) {
    const severity = clamp((retail.pctLong - extremeLongThreshold) / 40, 0, 1);
    raw = -severity * 10;
    explanation = `${retail.pctLong.toFixed(0)}% of retail traders are long (above the ${extremeLongThreshold}% extreme threshold), generating a contrarian bearish contribution that strengthens with how extreme positioning is.`;
  } else if (retail.pctShort > extremeShortThreshold) {
    const severity = clamp((retail.pctShort - extremeShortThreshold) / 40, 0, 1);
    raw = severity * 10;
    explanation = `${retail.pctShort.toFixed(0)}% of retail traders are short (above the ${extremeShortThreshold}% extreme threshold), generating a contrarian bullish contribution that strengthens with how extreme positioning is.`;
  }
  explanation += " Retail sentiment is estimated from aggregated broker/platform data.";
  return { raw: clamp(raw), explanation, source: "Aggregated retail broker positioning (estimate)", cadenceHours: 24 };
}

export function technicalFactor(instrument: Instrument) {
  const price = generatePriceData(instrument);
  const mas: [string, number][] = [
    ["20 EMA", price.ema20],
    ["50 SMA", price.sma50],
    ["100 SMA", price.sma100],
    ["200 SMA", price.sma200],
  ];
  const bullishCount = mas.filter(([, v]) => price.current > v).length;
  let raw = (bullishCount - 2) * 2.5;
  raw += clamp(price.roc10 * 0.3, -2, 2);
  if (price.adx14 > 25) raw *= 1.1;
  else if (price.adx14 < 15) raw *= 0.8;
  raw = clamp(raw);

  const alignment =
    bullishCount === 4
      ? "Price is above all four moving averages (strong bullish alignment)"
      : bullishCount === 0
        ? "Price is below all four moving averages (strong bearish alignment)"
        : `Price is above ${bullishCount} of 4 key moving averages (mixed alignment)`;
  let explanation = `${alignment}. Market structure shows ${price.structure.toLowerCase()}, ADX(14) at ${price.adx14.toFixed(1)} (${price.adx14 > 25 ? "trending" : price.adx14 < 15 ? "weak/range-bound" : "developing"}), 10-day ROC ${price.roc10 > 0 ? "+" : ""}${price.roc10.toFixed(2)}%.`;
  if (price.rsi14 > 70 || price.rsi14 < 30) {
    explanation += ` RSI(14) at ${price.rsi14.toFixed(0)} is overextended — flagged as reversal risk, not used to flip the score.`;
  }
  return { raw, explanation, source: "Price & indicator engine (daily bars)", cadenceHours: 24 };
}

export function seasonalityFactor(instrument: Instrument) {
  const stat = currentMonthStat(instrument);
  const raw = clamp(stat.avgReturn * 3);
  const explanation = `${stat.period} has averaged ${stat.avgReturn > 0 ? "+" : ""}${stat.avgReturn.toFixed(2)}% over ${stat.years} years, positive in ${stat.pctPositive}% of years (range ${stat.worstReturn.toFixed(1)}% to +${stat.bestReturn.toFixed(1)}%). Used as one contributing factor, not a standalone signal.`;
  return { raw, explanation, source: `${stat.years}-year seasonal history`, cadenceHours: 720 };
}

export const CCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  EUR: "EU",
  GBP: "GB",
  JPY: "JP",
  CHF: "CH",
  AUD: "AU",
  NZD: "NZ",
  CAD: "CA",
};

export function macroFactor(
  instrument: Instrument,
  metric: "growthScore" | "laborScore" | "inflationScore",
  label: "economic growth" | "labor market strength" | "inflation surprises"
) {
  const pair = currencyPairInfo(instrument);
  if (pair) {
    const [base, quote] = pair;
    const baseEco = getEconomy(CCY_TO_COUNTRY[base]);
    const quoteEco = getEconomy(CCY_TO_COUNTRY[quote]);
    const raw = clamp(baseEco[metric] - quoteEco[metric]);
    const explanation = `${base} ${label} score ${baseEco[metric] > 0 ? "+" : ""}${baseEco[metric].toFixed(1)} vs. ${quote} at ${quoteEco[metric] > 0 ? "+" : ""}${quoteEco[metric].toFixed(1)} — evaluated as a differential between both economies, not in isolation.`;
    return { raw, explanation };
  }
  const usEco = getEconomy("US");
  const weight = instrument.assetClass === "Indices" ? 0.8 : instrument.assetClass === "Crypto" ? 0.35 : 0.45;
  // Growth/labor strength isn't universally bullish — see pipeline/
  // asset-polarity.ts. A stronger economy raises real yields and reduces
  // safe-haven demand, a headwind (not a tailwind) for precious metals —
  // the demo generator mirrors the same sign flip the live FRED pipeline
  // applies in pipeline/macro.ts, so the two never disagree on direction.
  const polarity = metric === "inflationScore" ? 1 : growthLaborPolarity(instrument);
  const raw = clamp(usEco[metric] * weight * polarity);
  const polarityNote = polarity < 0 ? ` Treated as a headwind, not a tailwind, for ${instrument.name} — a stronger economy raises real yields and reduces safe-haven demand.` : "";
  const explanation = `US ${label} score is ${usEco[metric] > 0 ? "+" : ""}${usEco[metric].toFixed(1)}, applied as a global risk-appetite proxy scaled for ${instrument.assetClass.toLowerCase()}.${polarityNote}`;
  return { raw, explanation };
}

export function inflationFactorFor(instrument: Instrument) {
  const pair = currencyPairInfo(instrument);
  if (pair) {
    const [base, quote] = pair;
    const baseCb = getCentralBankByCurrency(base);
    const quoteCb = getCentralBankByCurrency(quote);
    const baseEco = getEconomy(CCY_TO_COUNTRY[base]);
    const quoteEco = getEconomy(CCY_TO_COUNTRY[quote]);
    const raw = clamp((baseCb.stanceScore - quoteCb.stanceScore) * 0.6 + (baseEco.inflationScore - quoteEco.inflationScore) * 0.4);
    const explanation = `${base} inflation is ${baseEco.inflationTrend.toLowerCase()} with a ${baseCb.stance.toLowerCase()} policy stance vs. ${quote} (${quoteEco.inflationTrend.toLowerCase()}, ${quoteCb.stance.toLowerCase()}). Rising inflation is treated as currency-supportive only when it raises the odds of tighter policy.`;
    return { raw, explanation };
  }

  const usEco = getEconomy("US");
  const usCb = getCentralBankByCurrency("USD");

  if (instrument.symbol === "XAUUSD" || instrument.symbol === "XAGUSD" || instrument.symbol === "XPTUSD") {
    const realYieldProxy = usCb.yield10y - usEco.inflation[0].actual;
    const raw = clamp(usEco.inflationScore * 0.5 - realYieldProxy * 1.3 - usCb.stanceScore * 0.3);
    const explanation = `Real-yield proxy (10Y yield ${usCb.yield10y.toFixed(2)}% minus CPI YoY ${usEco.inflation[0].actual.toFixed(1)}%) is ${realYieldProxy.toFixed(2)}%. Precious metals are scored on the combination of inflation, real yields, dollar strength and rate expectations together, not inflation alone.`;
    return { raw, explanation };
  }

  if (instrument.assetClass === "Indices") {
    const raw = clamp(-usEco.inflationScore * 0.7);
    const explanation = `US inflation surprise score is ${usEco.inflationScore > 0 ? "+" : ""}${usEco.inflationScore.toFixed(1)}. Moderating inflation is treated as positive for equities (lower rate pressure); persistently high inflation is treated as a headwind via higher borrowing costs.`;
    return { raw, explanation };
  }

  const raw = clamp(usEco.inflationScore * 0.35);
  const explanation = `US inflation surprise score is ${usEco.inflationScore > 0 ? "+" : ""}${usEco.inflationScore.toFixed(1)}, applied as a secondary factor via the dollar and rate-expectations channel.`;
  return { raw, explanation };
}

export function interestRateFactor(instrument: Instrument) {
  const pair = currencyPairInfo(instrument);
  if (pair) {
    const [base, quote] = pair;
    const baseCb = getCentralBankByCurrency(base);
    const quoteCb = getCentralBankByCurrency(quote);
    const diff = baseCb.currentRate - quoteCb.currentRate;
    const raw = clamp(diff * 4 + (baseCb.stanceScore - quoteCb.stanceScore) * 0.4);
    const explanation = `${base} policy rate ${baseCb.currentRate}% vs. ${quote} at ${quoteCb.currentRate}% — a ${diff.toFixed(2)}pt differential. ${baseCb.name} is ${baseCb.stance.toLowerCase()}; ${quoteCb.name} is ${quoteCb.stance.toLowerCase()}.`;
    return { raw, explanation };
  }
  const usCb = getCentralBankByCurrency("USD");
  const directionLabel = instrument.symbol.startsWith("X") || instrument.symbol === "BTCUSD" || instrument.symbol === "ETHUSD" ? "non-yielding / rate-sensitive assets" : "equities";
  const scale = instrument.assetClass === "Crypto" ? 0.7 : instrument.assetClass === "Indices" ? 0.8 : 0.9;
  const raw = clamp(-usCb.stanceScore * scale);
  const explanation = `Fed policy stance is ${usCb.stance.toLowerCase()} (stance score ${usCb.stanceScore > 0 ? "+" : ""}${usCb.stanceScore.toFixed(1)}), with real yields and rate expectations weighing on ${directionLabel}.`;
  return { raw, explanation };
}

export function newsFactor(instrument: Instrument) {
  const related = NEWS_ARTICLES.filter((n) => n.affectedMarkets.includes(instrument.symbol));
  if (related.length === 0) {
    return { raw: 0, explanation: "No significant recent news flow tagged to this market.", cadenceHours: 6, itemCount: 0 };
  }
  const signMap: Record<string, number> = { Bullish: 1, Bearish: -1, Mixed: 0, Neutral: 0, Unclear: 0 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const n of related) {
    const w = (n.importance / 100) * (n.confidence / 100);
    weightedSum += signMap[n.interpretation] * w;
    weightTotal += w;
  }
  const raw = clamp(weightTotal > 0 ? (weightedSum / weightTotal) * 10 : 0);
  const top = [...related].sort((a, b) => b.importance - a.importance)[0];
  const explanation = `${related.length} recent stor${related.length === 1 ? "y" : "ies"} tagged to this market. Most significant: "${top.headline}" (${top.interpretation}, importance ${top.importance}/100, confidence ${top.confidence}/100).`;
  return { raw, explanation, cadenceHours: 6, itemCount: related.length };
}

// ---- Aggregate scoring -----------------------------------------------------

function buildHistory(rng: Rng, total: number): ScoreHistoryPoint[] {
  const days = 30;
  const history: ScoreHistoryPoint[] = [];
  let walk = total - rng.float(-2, 2);
  for (let i = days - 1; i >= 0; i--) {
    walk += (total - walk) * 0.08 + rng.float(-0.9, 0.9);
    walk = clamp(walk);
    history.push({ date: daysAgo(i), score: Number(walk.toFixed(2)) });
  }
  history[history.length - 1] = { date: daysAgo(0), score: Number(total.toFixed(2)) };
  return history;
}

function computeConfidence(factors: ScoreFactor[], rng: Rng): number {
  const contributions = factors.map((f) => f.rawScore);
  const mean = contributions.reduce((s, v) => s + v, 0) / contributions.length;
  const variance = contributions.reduce((s, v) => s + (v - mean) ** 2, 0) / contributions.length;
  const agreement = Math.max(0, 1 - Math.sqrt(variance) / 10); // higher = factors agree on direction/strength

  const freshnessScore =
    factors.reduce((s, f) => {
      if (f.freshness === "live") return s + 1;
      if (f.freshness === "delayed") return s + 0.75;
      if (f.freshness === "estimated") return s + 0.55;
      return s + 0.3; // stale
    }, 0) / factors.length;

  const completeness = factors.filter((f) => f.freshness !== "estimated").length / factors.length;

  const base = 45 + agreement * 30 + freshnessScore * 15 + completeness * 10;
  return Math.round(clamp(base + rng.float(-3, 3), 15, 97));
}

const scoreCache = new Map<string, MarketScore>();

export function computeMarketScore(instrument: Instrument): MarketScore {
  const cached = scoreCache.get(instrument.symbol);
  if (cached) return cached;

  const rng = new Rng(`score:${instrument.symbol}`);

  const inst = institutionalFactor(instrument);
  const retail = retailSentimentFactor(instrument);
  const tech = technicalFactor(instrument);
  const season = seasonalityFactor(instrument);
  const growth = macroFactor(instrument, "growthScore", "economic growth");
  const inflation = inflationFactorFor(instrument);
  const labor = macroFactor(instrument, "laborScore", "labor market strength");
  const rates = interestRateFactor(instrument);
  const news = newsFactor(instrument);

  const raws: Record<ScoreFactorKey, { raw: number; explanation: string; source?: string; cadenceHours?: number }> = {
    institutional: { raw: inst.raw, explanation: inst.explanation, source: inst.source, cadenceHours: inst.cadenceHours },
    retailSentiment: { raw: retail.raw, explanation: retail.explanation, source: retail.source, cadenceHours: retail.cadenceHours },
    technical: { raw: tech.raw, explanation: tech.explanation, source: tech.source, cadenceHours: tech.cadenceHours },
    seasonality: { raw: season.raw, explanation: season.explanation, source: season.source, cadenceHours: season.cadenceHours },
    economicGrowth: { raw: growth.raw, explanation: growth.explanation, source: "Government & PMI statistical releases", cadenceHours: 168 },
    inflation: { raw: inflation.raw, explanation: inflation.explanation, source: "CPI / PPI / real-yield composite", cadenceHours: 168 },
    labor: { raw: labor.raw, explanation: labor.explanation, source: "Employment & labor-market releases", cadenceHours: 168 },
    interestRates: { raw: rates.raw, explanation: rates.explanation, source: "Central bank policy & yield curves", cadenceHours: 168 },
    news: { raw: news.raw, explanation: news.explanation, source: "News Intelligence engine", cadenceHours: news.cadenceHours },
  };

  const factors: ScoreFactor[] = (Object.keys(raws) as ScoreFactorKey[]).map((key) => {
    const weight = DEFAULT_FACTOR_WEIGHTS[key];
    const meta = freshnessMeta(rng, instrument.symbol, key, raws[key].cadenceHours ?? 24);
    let contribution = raws[key].raw * weight;
    if (meta.freshness === "stale") contribution *= 0.5;
    if (meta.freshness === "estimated") contribution *= 0.7;
    return {
      key,
      contribution: Number(contribution.toFixed(2)),
      rawScore: Number(raws[key].raw.toFixed(2)),
      weight,
      explanation: raws[key].explanation,
      source: raws[key].source ?? "Platform data pipeline",
      freshness: meta.freshness,
      lastUpdated: meta.lastUpdated,
      nextUpdate: meta.nextUpdate,
    };
  });

  const totalScore = Number(factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  const bias = classifyBias(totalScore);
  const history = buildHistory(rng, totalScore);
  const change24h = Number((history[history.length - 1].score - history[history.length - 2].score).toFixed(2));
  const confidence = computeConfidence(factors, rng);

  const result: MarketScore = {
    symbol: instrument.symbol,
    totalScore,
    bias,
    confidence,
    change24h,
    factors,
    history,
    lastUpdated: NOW.toISOString(),
  };
  scoreCache.set(instrument.symbol, result);
  return result;
}

export function factorLabel(key: ScoreFactorKey): string {
  return FACTOR_LABELS[key];
}

export { CENTRAL_BANKS };
