// Technical Trend factor engine — the only place that turns raw candles into
// the single normalized -10..+10 Technical Trend score described in the
// spec. Provider-agnostic: takes NormalizedCandle[] per timeframe, so it
// works identically whether the candles came from FMP or (for now) the demo
// generator's output shaped into the same type.
import { NormalizedCandle } from "@/services/types";
import { adx, atr, detectStructure, macd, roc, rsi, sma, Structure } from "./indicators";

export type TechnicalTimeframeCandles = {
  daily: NormalizedCandle[];
  h4?: NormalizedCandle[];
  h1?: NormalizedCandle[];
};

export type TechnicalTimeframeDetail = {
  timeframe: "daily" | "4h" | "1h";
  score: number;
  bullishMaCount: number;
  availableMaCount: number;
  structure: Structure;
  adx: number | null;
  rsi: number | null;
  macdHistogram: number | null;
  roc: number | null;
};

export type TechnicalTrendResult = {
  rawScore: number;
  explanation: string;
  currentPrice: number;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  rsi14: number | null;
  adx14: number | null;
  atr14: number | null;
  roc10: number | null;
  structure: Structure;
  timeframes: TechnicalTimeframeDetail[];
};

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

function scoreTimeframe(candles: NormalizedCandle[], label: TechnicalTimeframeDetail["timeframe"]): TechnicalTimeframeDetail | null {
  if (candles.length < 25) return null; // need at least ~25 bars for a meaningful SMA20 + structure read
  const closes = candles.map((c) => c.close);
  const current = closes[closes.length - 1];

  const maPeriods = [20, 50, 100, 200];
  const maValues = maPeriods.map((p) => sma(closes, p)).filter((v): v is number => v !== null);
  const bullishMaCount = maValues.filter((v) => current > v).length;
  const availableMaCount = maValues.length;
  const maScore = availableMaCount > 0 ? ((bullishMaCount - availableMaCount / 2) / (availableMaCount / 2)) * 5 : 0;

  const atrValue = atr(candles, 14);
  const macdResult = macd(closes);
  const macdScore = macdResult && atrValue && atrValue > 0 ? clamp((macdResult.histogram / atrValue) * 3, -2, 2) : 0;

  const rocValue = roc(closes, 10);
  const rocScore = rocValue !== null ? clamp(rocValue * 0.3, -2, 2) : 0;

  const structure = detectStructure(candles, 20);
  const structureAdj = structure === "Higher Highs & Higher Lows" ? 0.5 : structure === "Lower Highs & Lower Lows" ? -0.5 : 0;

  const adxValue = adx(candles, 14);
  const trendMultiplier = adxValue === null ? 1 : adxValue >= 25 ? 1.15 : adxValue >= 15 ? 1.0 : 0.8;

  const rawBeforeAdx = maScore + macdScore + rocScore + structureAdj;
  const score = clamp(rawBeforeAdx * trendMultiplier);

  return {
    timeframe: label,
    score,
    bullishMaCount,
    availableMaCount,
    structure,
    adx: adxValue,
    rsi: rsi(closes, 14),
    macdHistogram: macdResult?.histogram ?? null,
    roc: rocValue,
  };
}

// Daily carries most of the weight (matches the rest of the app's
// daily-bar-driven design); intraday timeframes confirm or soften it.
const TIMEFRAME_WEIGHTS: Record<TechnicalTimeframeDetail["timeframe"], number> = { daily: 0.6, "4h": 0.25, "1h": 0.15 };

export function computeTechnicalTrend(candles: TechnicalTimeframeCandles): TechnicalTrendResult | null {
  const dailyDetail = scoreTimeframe(candles.daily, "daily");
  if (!dailyDetail) return null; // daily history is the minimum bar for this factor to exist at all

  const h4Detail = candles.h4 ? scoreTimeframe(candles.h4, "4h") : null;
  const h1Detail = candles.h1 ? scoreTimeframe(candles.h1, "1h") : null;
  const timeframes = [dailyDetail, h4Detail, h1Detail].filter((t): t is TechnicalTimeframeDetail => t !== null);

  const totalWeight = timeframes.reduce((s, t) => s + TIMEFRAME_WEIGHTS[t.timeframe], 0);
  const rawScore = clamp(timeframes.reduce((s, t) => s + t.score * (TIMEFRAME_WEIGHTS[t.timeframe] / totalWeight), 0));

  const closes = candles.daily.map((c) => c.close);
  const current = closes[closes.length - 1];
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const adx14 = adx(candles.daily, 14);
  const atr14 = atr(candles.daily, 14);
  const roc10 = roc(closes, 10);
  const structure = dailyDetail.structure;

  const alignment =
    dailyDetail.availableMaCount > 0 && dailyDetail.bullishMaCount === dailyDetail.availableMaCount
      ? `Price is above all ${dailyDetail.availableMaCount} available moving averages (strong bullish alignment)`
      : dailyDetail.bullishMaCount === 0
        ? `Price is below all ${dailyDetail.availableMaCount} available moving averages (strong bearish alignment)`
        : `Price is above ${dailyDetail.bullishMaCount} of ${dailyDetail.availableMaCount} available moving averages (mixed alignment)`;

  let explanation = `${alignment}. Daily market structure shows ${structure.toLowerCase()}, ADX(14) at ${adx14 !== null ? adx14.toFixed(1) : "n/a"} (${adx14 === null ? "insufficient history" : adx14 >= 25 ? "trending" : adx14 >= 15 ? "developing" : "weak/range-bound"}), 10-day ROC ${roc10 !== null ? `${roc10 > 0 ? "+" : ""}${roc10.toFixed(2)}%` : "n/a"}.`;
  if (rsi14 !== null && (rsi14 > 70 || rsi14 < 30)) {
    explanation += ` RSI(14) at ${rsi14.toFixed(0)} is overextended — flagged as reversal risk, not used to flip the score.`;
  }
  if (timeframes.length > 1) {
    const others = timeframes.filter((t) => t.timeframe !== "daily");
    const agree = others.every((t) => Math.sign(t.score) === Math.sign(dailyDetail.score) || t.score === 0);
    explanation += ` ${agree ? "Intraday timeframes confirm" : "Intraday timeframes diverge from"} the daily read (${others.map((t) => `${t.timeframe} ${t.score > 0 ? "+" : ""}${t.score.toFixed(1)}`).join(", ")}).`;
  }

  return {
    rawScore,
    explanation,
    currentPrice: current,
    sma20,
    sma50,
    sma100,
    sma200,
    rsi14,
    adx14,
    atr14,
    roc10,
    structure,
    timeframes,
  };
}
