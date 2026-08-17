import { NormalizedCandle } from "@/services/types";

// Deterministic synthetic OHLC series for engine unit tests only — this is
// test fixture data, never rendered in the app or used as a data source.
// A seeded LCG keeps runs reproducible without pulling in the app's Rng.
function lcg(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function buildTrendingCandles(opts: {
  bars: number;
  startPrice: number;
  trendPerBar: number; // signed drift added each bar
  noise: number; // +/- random wiggle per bar
  seed?: number;
}): NormalizedCandle[] {
  const rand = lcg(opts.seed ?? 42);
  const candles: NormalizedCandle[] = [];
  let price = opts.startPrice;
  const start = new Date("2025-01-01T00:00:00Z").getTime();

  for (let i = 0; i < opts.bars; i++) {
    const wiggle = (rand() - 0.5) * 2 * opts.noise;
    const open = price;
    price = Math.max(0.01, price + opts.trendPerBar + wiggle);
    const close = price;
    const high = Math.max(open, close) + Math.abs(wiggle) * 0.5;
    const low = Math.min(open, close) - Math.abs(wiggle) * 0.5;
    candles.push({
      date: new Date(start + i * 86_400_000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1000 + Math.round(rand() * 500),
    });
  }
  return candles;
}

export function buildChoppyCandles(bars: number, price = 100, seed = 7): NormalizedCandle[] {
  return buildTrendingCandles({ bars, startPrice: price, trendPerBar: 0, noise: price * 0.01, seed });
}

/** Multi-year daily series (weekdays only) with a per-calendar-month drift
 * bias, for seasonality-engine fixtures. `monthBiasPctPerDay(month)` is the
 * average daily % drift applied to every trading day in that UTC month. */
export function buildMultiYearDailyCandles(opts: {
  years: number;
  startYear: number;
  startPrice: number;
  monthBiasPctPerDay: (month: number) => number;
  noise?: number;
  seed?: number;
}): NormalizedCandle[] {
  const rand = lcg(opts.seed ?? 99);
  const candles: NormalizedCandle[] = [];
  let price = opts.startPrice;
  const noise = opts.noise ?? price * 0.002;

  const start = new Date(Date.UTC(opts.startYear, 0, 1));
  const end = new Date(Date.UTC(opts.startYear + opts.years, 0, 1));

  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue; // skip weekends
    const bias = opts.monthBiasPctPerDay(d.getUTCMonth());
    const drift = price * (bias / 100);
    const wiggle = (rand() - 0.5) * 2 * noise;
    const open = price;
    price = Math.max(0.01, price + drift + wiggle);
    const close = price;
    candles.push({
      date: d.toISOString(),
      open,
      high: Math.max(open, close) + Math.abs(wiggle) * 0.5,
      low: Math.min(open, close) - Math.abs(wiggle) * 0.5,
      close,
      volume: 1000,
    });
  }
  return candles;
}
