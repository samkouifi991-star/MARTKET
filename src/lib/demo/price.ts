import { Instrument, PriceData, PricePoint } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";
import { instrumentRegime } from "./regime";

const BASE_PRICES: Record<string, number> = {
  EURUSD: 1.0865,
  GBPUSD: 1.271,
  USDJPY: 151.2,
  USDCHF: 0.882,
  AUDUSD: 0.658,
  NZDUSD: 0.6,
  USDCAD: 1.362,
  EURGBP: 0.855,
  EURJPY: 164.3,
  GBPJPY: 192.1,
  SPX500: 5480,
  NAS100: 19250,
  DJ30: 40650,
  RUT2000: 2145,
  DAX40: 18420,
  FTSE100: 8210,
  NIKKEI225: 39850,
  XAUUSD: 2415,
  XAGUSD: 28.4,
  COPPER: 4.32,
  XPTUSD: 985,
  WTIUSD: 78.6,
  NATGAS: 2.15,
  BTCUSD: 64200,
  ETHUSD: 3150,
};

function sma(series: number[], period: number): number {
  const slice = series.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function ema(series: number[], period: number): number {
  const k = 2 / (period + 1);
  let value = series[0];
  for (let i = 1; i < series.length; i++) value = series[i] * k + value * (1 - k);
  return value;
}

function rsi(series: number[], period = 14): number {
  let gains = 0;
  let losses = 0;
  const slice = series.slice(-period - 1);
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

function adx(series: number[], period = 14): number {
  // Simplified proxy: average absolute daily move normalized against range, scaled 0-60.
  const slice = series.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < slice.length; i++) sum += Math.abs(slice[i] - slice[i - 1]);
  const avgMove = sum / period;
  const price = slice[slice.length - 1];
  return Math.min(60, (avgMove / price) * 100 * 18);
}

const cache = new Map<string, PriceData>();

export function generatePriceData(instrument: Instrument): PriceData {
  const cached = cache.get(instrument.symbol);
  if (cached) return cached;

  const rng = new Rng(`price:${instrument.symbol}`);
  const base = BASE_PRICES[instrument.symbol] ?? 100;
  const days = 260;
  const dailyVol = base * rng.float(0.004, 0.016);
  const driftStrength = rng.float(-0.00035, 0.00035);

  const closes: number[] = [];
  let price = base * rng.float(0.88, 1.12);
  // Give recent data (last ~40 days) a coherent trend, driven by the shared
  // instrument regime, so MAs/RSI/structure agree with the trend the scoring
  // engine will describe (and with the other factors that also read the regime).
  const trendBias = instrumentRegime(instrument.symbol);
  for (let i = 0; i < days; i++) {
    const isRecent = i > days - 45;
    const trendPush = isRecent ? trendBias * dailyVol * 0.4 : driftStrength * price;
    const noise = rng.float(-1, 1) * dailyVol;
    price = Math.max(price + trendPush + noise, base * 0.4);
    closes.push(price);
  }
  // Force the final value toward the intended trend direction for legible demo data.
  closes[closes.length - 1] = closes[closes.length - 2] + trendBias * dailyVol * 0.6;

  const series: PricePoint[] = closes.map((p, idx) => ({
    date: new Date(NOW.getTime() - (days - 1 - idx) * 86_400_000).toISOString(),
    price: Number(p.toFixed(instrument.decimals + 2)),
  }));

  const current = closes[closes.length - 1];
  const prevDay = closes[closes.length - 2];
  const ema20 = ema(closes.slice(-40), 20);
  const sma50 = sma(closes, 50);
  const sma100 = sma(closes, 100);
  const sma200 = sma(closes, Math.min(200, closes.length));
  const rsi14 = rsi(closes, 14);
  const adx14 = adx(closes, 14);
  const roc10 = ((current - closes[closes.length - 11]) / closes[closes.length - 11]) * 100;

  const recentHigh = Math.max(...closes.slice(-20));
  const recentLow = Math.min(...closes.slice(-20));
  const priorHigh = Math.max(...closes.slice(-40, -20));
  const priorLow = Math.min(...closes.slice(-40, -20));
  let structure: PriceData["structure"] = "Choppy / Mixed";
  if (recentHigh > priorHigh && recentLow > priorLow) structure = "Higher Highs & Higher Lows";
  else if (recentHigh < priorHigh && recentLow < priorLow) structure = "Lower Highs & Lower Lows";

  const data: PriceData = {
    symbol: instrument.symbol,
    current: Number(current.toFixed(instrument.decimals + 2)),
    changePct24h: ((current - prevDay) / prevDay) * 100,
    series,
    ema20,
    sma50,
    sma100,
    sma200,
    rsi14,
    adx14,
    roc10,
    structure,
  };
  cache.set(instrument.symbol, data);
  return data;
}
