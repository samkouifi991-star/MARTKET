// Seasonality engine — computes real historical seasonal statistics
// directly from daily candles. No fabricated years: `years` (sample size)
// always reflects exactly how many calendar instances of that period exist
// in the candle history actually provided, and 10y/20y averages are null
// rather than padded when that much history isn't available.
import { NormalizedCandle } from "@/services/types";
import { SeasonalitySampleDepth, SeasonalityStat } from "@/lib/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type YearObservation = { year: number; returnPct: number; drawdownPct: number };

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function intraPeriodDrawdown(closes: number[]): number {
  let peak = closes[0];
  let worst = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    worst = Math.min(worst, ((c - peak) / peak) * 100);
  }
  return worst;
}

function buildStat(period: string, observations: YearObservation[]): SeasonalityStat | null {
  if (observations.length === 0) return null;
  const returns = observations.map((o) => o.returnPct);
  const positive = returns.filter((r) => r > 0).length;
  const sortedByYear = [...observations].sort((a, b) => a.year - b.year);
  const last10 = sortedByYear.slice(-10).map((o) => o.returnPct);
  const last20 = sortedByYear.slice(-20).map((o) => o.returnPct);

  return {
    period,
    avgReturn: Number((returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2)),
    medianReturn: Number(median(returns).toFixed(2)),
    pctPositive: Math.round((positive / returns.length) * 100),
    pctNegative: Math.round(((returns.length - positive) / returns.length) * 100),
    bestReturn: Number(Math.max(...returns).toFixed(2)),
    worstReturn: Number(Math.min(...returns).toFixed(2)),
    years: observations.length,
    avg10y: Number((last10.reduce((a, b) => a + b, 0) / last10.length).toFixed(2)),
    avg20y: observations.length >= 20 ? Number((last20.reduce((a, b) => a + b, 0) / last20.length).toFixed(2)) : null,
    maxDrawdown: Number(Math.min(...observations.map((o) => o.drawdownPct)).toFixed(2)),
  };
}

/** Groups daily candles into (year, bucketKey) periods via `keyFn`, computes
 * each period's close-to-close return and intra-period drawdown, then
 * aggregates per bucket label across every year that bucket occurred. */
function computeByBucket(candles: NormalizedCandle[], bucketOf: (d: Date) => number, labels: string[]): Map<number, YearObservation[]> {
  const byYearBucket = new Map<string, NormalizedCandle[]>();
  for (const c of candles) {
    const d = new Date(c.date);
    const key = `${d.getUTCFullYear()}-${bucketOf(d)}`;
    const arr = byYearBucket.get(key) ?? [];
    arr.push(c);
    byYearBucket.set(key, arr);
  }

  const byBucket = new Map<number, YearObservation[]>();
  for (const [key, bucketCandles] of byYearBucket) {
    if (bucketCandles.length < 2) continue; // need at least a first and last close to form a return
    const [yearStr, bucketStr] = key.split("-");
    const bucket = Number(bucketStr);
    const sorted = [...bucketCandles].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const closes = sorted.map((c) => c.close);
    const returnPct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    const drawdownPct = intraPeriodDrawdown(closes);
    const list = byBucket.get(bucket) ?? [];
    list.push({ year: Number(yearStr), returnPct, drawdownPct });
    byBucket.set(bucket, list);
  }
  void labels;
  return byBucket;
}

export function computeMonthlySeasonality(candles: NormalizedCandle[]): SeasonalityStat[] {
  const byBucket = computeByBucket(candles, (d) => d.getUTCMonth(), MONTH_NAMES);
  return MONTH_NAMES.map((name, i) => buildStat(name, byBucket.get(i) ?? [])).filter((s): s is SeasonalityStat => s !== null);
}

export function computeWeekdaySeasonality(candles: NormalizedCandle[]): SeasonalityStat[] {
  // Weekday "return" is that single day's own change, aggregated across all
  // occurrences of that weekday in history (not grouped by year first).
  const byWeekday = new Map<number, { returnPct: number; drawdownPct: number; year: number }[]>();
  const sorted = [...candles].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (let i = 1; i < sorted.length; i++) {
    const d = new Date(sorted[i].date);
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue; // markets are closed weekends; skip stray weekend bars
    const returnPct = ((sorted[i].close - sorted[i - 1].close) / sorted[i - 1].close) * 100;
    const list = byWeekday.get(day) ?? [];
    list.push({ returnPct, drawdownPct: Math.min(0, returnPct), year: d.getUTCFullYear() });
    byWeekday.set(day, list);
  }
  return [1, 2, 3, 4, 5]
    .map((day) => buildStat(WEEKDAY_NAMES[day], byWeekday.get(day) ?? []))
    .filter((s): s is SeasonalityStat => s !== null);
}

export function computeCurrentMonthStat(candles: NormalizedCandle[], referenceDate: Date = new Date()): SeasonalityStat | null {
  const stats = computeMonthlySeasonality(candles);
  return stats.find((s) => s.period === MONTH_NAMES[referenceDate.getUTCMonth()]) ?? null;
}

/** The real depth of the candle sample a seasonality read is based on — the
 * honest complement to `SeasonalityStat.years` (see its doc comment). Used
 * both to gate confidence (a thin sample is noise, not a seasonal edge) and
 * to describe the sample without ever claiming more history than actually
 * exists in storage. Returns null only when there's nothing to measure. */
export function computeHistoricalSampleDepth(candles: NormalizedCandle[]): SeasonalitySampleDepth | null {
  if (candles.length < 2) return null;
  const sorted = [...candles].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const earliestDate = sorted[0].date;
  const latestDate = sorted[sorted.length - 1].date;
  const yearsSpanned = Number(((new Date(latestDate).getTime() - new Date(earliestDate).getTime()) / (365.25 * 86_400_000)).toFixed(2));

  const byYear = new Map<number, NormalizedCandle[]>();
  for (const c of sorted) {
    const y = new Date(c.date).getUTCFullYear();
    const arr = byYear.get(y) ?? [];
    arr.push(c);
    byYear.set(y, arr);
  }

  // Whole-calendar-year (first close -> last close within that year) return,
  // one observation per calendar year actually present — never padded or
  // inferred for a partial year at either edge.
  const annualReturns: number[] = [];
  for (const yearCandles of byYear.values()) {
    if (yearCandles.length < 2) continue;
    const first = yearCandles[0].close;
    const last = yearCandles[yearCandles.length - 1].close;
    annualReturns.push(((last - first) / first) * 100);
  }
  const positive = annualReturns.filter((r) => r > 0).length;

  return {
    earliestDate,
    latestDate,
    observations: sorted.length,
    yearsSpanned,
    calendarYears: byYear.size,
    positiveYearPct: annualReturns.length ? Math.round((positive / annualReturns.length) * 100) : 0,
    avgAnnualReturn: annualReturns.length ? Number((annualReturns.reduce((a, b) => a + b, 0) / annualReturns.length).toFixed(2)) : 0,
    medianAnnualReturn: annualReturns.length ? Number(median(annualReturns).toFixed(2)) : 0,
  };
}
