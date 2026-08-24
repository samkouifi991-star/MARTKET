// Historical reliability / backtest framework (requirement #20) — computes
// forward-return statistics at 1/3/5/10/20 trading days for individual V2
// factors, factor combinations, and specific conditions (e.g. cycles where
// an event shock fired), from real stored factorScoresV2 history and real
// stored daily candles. Pure math only, no I/O, so it's fully unit-testable
// against deterministic synthetic fixtures; scripts/backtest-v2-factors.ts
// is the thin CLI wrapper that feeds it real data.
//
// This is a slow-moving, honest measurement tool, not a self-optimizing
// weight search: reliability.ts's MIN_SAMPLE_SIZE (30) is the bar for
// treating any of this as more than noise, and nothing here writes back
// into the live engine automatically — a human reviews these numbers.
export const BACKTEST_HORIZONS_DAYS = [1, 3, 5, 10, 20] as const;

export type CandleClose = { date: string; close: number };
export type FactorHistoryPoint = { date: string; factors: { key: string; contribution: number }[] };

// Candles must be sorted ascending by date with no duplicate dates — never
// interpolates a synthetic price for a missing date.
function indexOfDate(candles: CandleClose[], date: string): number | null {
  const idx = candles.findIndex((c) => c.date === date);
  return idx === -1 ? null : idx;
}

export function forwardReturns(candles: CandleClose[], asOfDate: string, horizons: readonly number[] = BACKTEST_HORIZONS_DAYS): Partial<Record<number, number>> {
  const idx = indexOfDate(candles, asOfDate);
  if (idx === null) return {};

  const result: Partial<Record<number, number>> = {};
  for (const h of horizons) {
    const forwardIdx = idx + h;
    if (forwardIdx >= candles.length) continue; // no real forward data yet — never fabricated
    const now = candles[idx].close;
    const future = candles[forwardIdx].close;
    if (now === 0) continue;
    result[h] = (future - now) / now;
  }
  return result;
}

export type BacktestSample = { date: string; signal: number; forwardReturn: number };

export type BacktestStat = {
  horizonDays: number;
  sampleSize: number;
  // % of DECISIVE samples (signal != 0) whose direction matched the forward
  // return. null when there were no decisive samples at all.
  hitRate: number | null;
  // % of ALL samples whose direction matched the forward return — a neutral
  // signal (0) never counts as correct, so this is always <= hitRate.
  directionalAccuracy: number | null;
  // Mean of sign(signal) * forwardReturn — the average return from trading
  // in the signal's direction each cycle (0 contribution for neutral signals).
  avgReturn: number | null;
  // Worst peak-to-trough decline of the cumulative sign(signal)*forwardReturn
  // equity curve, in the order samples were given — callers must pass
  // samples already in chronological order.
  maxDrawdown: number | null;
};

export function summarizeSamples(samples: BacktestSample[], horizonDays: number): BacktestStat {
  const sampleSize = samples.length;
  if (sampleSize === 0) {
    return { horizonDays, sampleSize: 0, hitRate: null, directionalAccuracy: null, avgReturn: null, maxDrawdown: null };
  }

  const decisive = samples.filter((s) => s.signal !== 0);
  const correctDecisive = decisive.filter((s) => Math.sign(s.signal) === Math.sign(s.forwardReturn));
  const hitRate = decisive.length > 0 ? (correctDecisive.length / decisive.length) * 100 : null;
  const directionalAccuracy = (correctDecisive.length / sampleSize) * 100;

  const edgeReturns = samples.map((s) => (s.signal === 0 ? 0 : Math.sign(s.signal) * s.forwardReturn));
  const avgReturn = edgeReturns.reduce((a, b) => a + b, 0) / sampleSize;

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const r of edgeReturns) {
    cumulative += r;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
  }

  return {
    horizonDays,
    sampleSize,
    hitRate: hitRate !== null ? Number(hitRate.toFixed(1)) : null,
    directionalAccuracy: Number(directionalAccuracy.toFixed(1)),
    avgReturn: Number(avgReturn.toFixed(5)),
    maxDrawdown: Number(maxDrawdown.toFixed(5)),
  };
}

export type FactorBacktestResult = { label: string; stats: BacktestStat[] };

// signalOf extracts the "signal" for one history point (a single factor's
// contribution, or a sum of several for a combination). A signal of 0 means
// "no opinion this cycle" — excluded from hitRate, but still counted (as a
// miss) in directionalAccuracy and in the equity curve as a flat cycle.
export function runBacktest(
  history: FactorHistoryPoint[],
  candles: CandleClose[],
  label: string,
  signalOf: (point: FactorHistoryPoint) => number,
  filter?: (point: FactorHistoryPoint) => boolean,
  horizons: readonly number[] = BACKTEST_HORIZONS_DAYS
): FactorBacktestResult {
  const filtered = filter ? history.filter(filter) : history;
  const stats = horizons.map((h) => {
    const samples: BacktestSample[] = [];
    for (const point of filtered) {
      const fr = forwardReturns(candles, point.date, [h]);
      const forwardReturn = fr[h];
      if (forwardReturn === undefined) continue;
      samples.push({ date: point.date, signal: signalOf(point), forwardReturn });
    }
    return summarizeSamples(samples, h);
  });
  return { label, stats };
}

export function factorSignal(point: FactorHistoryPoint, factorKey: string): number {
  return point.factors.find((f) => f.key === factorKey)?.contribution ?? 0;
}

export function combinedSignal(point: FactorHistoryPoint, factorKeys: string[]): number {
  return factorKeys.reduce((sum, key) => sum + factorSignal(point, key), 0);
}

// A concrete stand-in for requirement #20's "specific surprise conditions"
// (e.g. "Gold when NFP surprise Z > 1.5"): cycles where V2's event-shock
// pseudo-factor actually fired, using data already present in
// factorScoresV2 history rather than requiring a fresh join against
// economicReleaseSurprises for this first version of the framework.
export function hadEventShock(point: FactorHistoryPoint): boolean {
  return point.factors.some((f) => f.key === "event" && f.contribution !== 0);
}
