// Pure technical-indicator math. No provider awareness, no I/O — every
// function here takes plain candle/price arrays (oldest-first) and returns a
// number, so it can be unit-tested with fixtures and reused by both the
// live pipeline (real FMP candles) and, if ever needed, the demo generator.
import { NormalizedCandle } from "@/services/types";

export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let value = sma(closes.slice(0, period), period)!;
  for (let i = period; i < closes.length; i++) value = closes[i] * k + value * (1 - k);
  return value;
}

/** Wilder's RSI. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type Macd = { macdLine: number; signalLine: number; histogram: number };

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): Macd | null {
  if (closes.length < slow + signalPeriod) return null;
  const macdSeries: number[] = [];
  for (let end = slow; end <= closes.length; end++) {
    const slice = closes.slice(0, end);
    const fastEma = ema(slice, fast);
    const slowEma = ema(slice, slow);
    if (fastEma === null || slowEma === null) continue;
    macdSeries.push(fastEma - slowEma);
  }
  if (macdSeries.length < signalPeriod) return null;
  const signalLine = ema(macdSeries, signalPeriod)!;
  const macdLine = macdSeries[macdSeries.length - 1];
  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

function trueRange(curr: NormalizedCandle, prevClose: number): number {
  return Math.max(curr.high - curr.low, Math.abs(curr.high - prevClose), Math.abs(curr.low - prevClose));
}

/** Wilder-smoothed Average True Range. */
export function atr(candles: NormalizedCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i], candles[i - 1].close));
  let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) value = (value * (period - 1) + trs[i]) / period;
  return value;
}

/** Wilder's ADX via smoothed +DI/-DI. Returns null until enough bars exist. */
export function adx(candles: NormalizedCandle[], period = 14): number | null {
  if (candles.length < period * 2 + 1) return null;

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(trueRange(candles[i], candles[i - 1].close));
  }

  function wilderSmooth(values: number[], p: number): number[] {
    const out: number[] = [values.slice(0, p).reduce((a, b) => a + b, 0)];
    for (let i = p; i < values.length; i++) out.push(out[out.length - 1] - out[out.length - 1] / p + values[i]);
    return out;
  }

  const smoothedPlusDm = wilderSmooth(plusDm, period);
  const smoothedMinusDm = wilderSmooth(minusDm, period);
  const smoothedTr = wilderSmooth(trs, period);

  const dx: number[] = [];
  for (let i = 0; i < smoothedTr.length; i++) {
    const plusDi = smoothedTr[i] === 0 ? 0 : (100 * smoothedPlusDm[i]) / smoothedTr[i];
    const minusDi = smoothedTr[i] === 0 ? 0 : (100 * smoothedMinusDm[i]) / smoothedTr[i];
    const sum = plusDi + minusDi;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(plusDi - minusDi)) / sum);
  }
  if (dx.length < period) return null;
  return sma(dx, period);
}

export function roc(closes: number[], period = 10): number | null {
  if (closes.length < period + 1) return null;
  const past = closes[closes.length - 1 - period];
  const current = closes[closes.length - 1];
  if (past === 0) return null;
  return ((current - past) / past) * 100;
}

export type Structure = "Higher Highs & Higher Lows" | "Lower Highs & Lower Lows" | "Choppy / Mixed";

export function detectStructure(candles: NormalizedCandle[], window = 20): Structure {
  if (candles.length < window * 2) return "Choppy / Mixed";
  const recent = candles.slice(-window);
  const prior = candles.slice(-window * 2, -window);
  const recentHigh = Math.max(...recent.map((c) => c.high));
  const recentLow = Math.min(...recent.map((c) => c.low));
  const priorHigh = Math.max(...prior.map((c) => c.high));
  const priorLow = Math.min(...prior.map((c) => c.low));
  if (recentHigh > priorHigh && recentLow > priorLow) return "Higher Highs & Higher Lows";
  if (recentHigh < priorHigh && recentLow < priorLow) return "Lower Highs & Lower Lows";
  return "Choppy / Mixed";
}
