import { Instrument, SeasonalityStat } from "../types";
import { Rng } from "../rng";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function buildStat(rng: Rng, period: string, years: number): SeasonalityStat {
  const avgReturn = Number(rng.float(-2.2, 2.2).toFixed(2));
  const spread = Math.abs(avgReturn) + rng.float(1.5, 4);
  const pctPositive = Math.round(Math.min(85, Math.max(15, 50 + avgReturn * 9 + rng.float(-8, 8))));
  return {
    period,
    avgReturn,
    medianReturn: Number((avgReturn + rng.float(-0.5, 0.5)).toFixed(2)),
    pctPositive,
    pctNegative: 100 - pctPositive,
    bestReturn: Number((avgReturn + spread).toFixed(2)),
    worstReturn: Number((avgReturn - spread).toFixed(2)),
    years,
    avg10y: Number((avgReturn + rng.float(-0.6, 0.6)).toFixed(2)),
    avg20y: years >= 20 ? Number((avgReturn + rng.float(-0.8, 0.8)).toFixed(2)) : null,
    maxDrawdown: Number(-(Math.abs(avgReturn) + rng.float(2, 6)).toFixed(2)),
  };
}

const monthlyCache = new Map<string, SeasonalityStat[]>();
const weekdayCache = new Map<string, SeasonalityStat[]>();
const weekOfYearCache = new Map<string, SeasonalityStat[]>();

export function monthlySeasonality(instrument: Instrument): SeasonalityStat[] {
  let stats = monthlyCache.get(instrument.symbol);
  if (stats) return stats;
  const rng = new Rng(`season-month:${instrument.symbol}`);
  stats = MONTHS.map((m) => buildStat(rng, m, rng.int(15, 25)));
  monthlyCache.set(instrument.symbol, stats);
  return stats;
}

export function weekdaySeasonality(instrument: Instrument): SeasonalityStat[] {
  let stats = weekdayCache.get(instrument.symbol);
  if (stats) return stats;
  const rng = new Rng(`season-weekday:${instrument.symbol}`);
  stats = WEEKDAYS.map((d) => buildStat(rng, d, rng.int(15, 25)));
  weekdayCache.set(instrument.symbol, stats);
  return stats;
}

export function weekOfYearSeasonality(instrument: Instrument): SeasonalityStat[] {
  let stats = weekOfYearCache.get(instrument.symbol);
  if (stats) return stats;
  const rng = new Rng(`season-week:${instrument.symbol}`);
  stats = Array.from({ length: 52 }, (_, i) => buildStat(rng, `Week ${i + 1}`, rng.int(15, 25)));
  weekOfYearCache.set(instrument.symbol, stats);
  return stats;
}

export function currentMonthStat(instrument: Instrument): SeasonalityStat {
  // "Today" is fixed at Aug 6 for this demo, so August is the live period.
  return monthlySeasonality(instrument)[7];
}
