// Pure display-layer helpers for PriceScoreOverlayChart (components/charts/
// PriceScoreOverlayChart.tsx) — extracted the same way ScoreHistoryChart's
// dedupe/window logic was (score-history-view.ts), purely so it's unit-
// testable under this repo's vitest config (src/**/*.test.ts only). Never
// touches storage; only decides what gets charted from data the caller
// already fetched (Market Detail's existing price series + score history —
// see markets/[symbol]/page.tsx, which passes the exact same
// recentPriceSeries/score.history it already renders as two separate
// charts).
import { PricePoint, ScoreHistoryPoint } from "@/lib/types";
import { dedupeScoreHistoryByDate, MIN_LEGITIMATE_OBSERVATIONS } from "./score-history-view";

export { MIN_LEGITIMATE_OBSERVATIONS };

export type OverlayPoint = { day: string; price: number | null; score: number | null };

export type OverlayResult =
  | { status: "building"; deduped: ScoreHistoryPoint[] }
  | { status: "ready"; points: OverlayPoint[]; earliestScoreDate: string; trimmedToScoreWindow: boolean };

/** Joins the price series and score history on calendar day. Never
 * fabricates a value for either series — a day missing from one series
 * simply gets `null` for that field, which the chart renders as a gap, not
 * an interpolated line. Only charts the period from real score tracking's
 * own earliest date onward (never extends the price series further back
 * than genuine score tracking began) — see the pre-launch audit's honesty
 * requirement for this feature. Below MIN_LEGITIMATE_OBSERVATIONS deduped
 * score points, returns "building" so the caller can show the same
 * "tracking began <date>" message ScoreHistoryChart already uses instead
 * of a misleading, mostly-empty overlay. */
export function buildPriceScoreOverlay(priceSeries: PricePoint[], scoreHistory: ScoreHistoryPoint[]): OverlayResult {
  const deduped = dedupeScoreHistoryByDate(scoreHistory);
  if (deduped.length < MIN_LEGITIMATE_OBSERVATIONS) {
    return { status: "building", deduped };
  }

  const earliestScoreDate = deduped[0].date;
  const earliestScoreDay = earliestScoreDate.slice(0, 10);
  const earliestPriceDay = priceSeries[0]?.date.slice(0, 10) ?? earliestScoreDay;

  const priceByDay = new Map(priceSeries.filter((p) => p.date.slice(0, 10) >= earliestScoreDay).map((p) => [p.date.slice(0, 10), p.price]));
  const scoreByDay = new Map(deduped.map((s) => [s.date.slice(0, 10), s.score]));

  const days = [...new Set([...priceByDay.keys(), ...scoreByDay.keys()])].sort();
  const points: OverlayPoint[] = days.map((day) => ({
    day,
    price: priceByDay.get(day) ?? null,
    score: scoreByDay.get(day) ?? null,
  }));

  return { status: "ready", points, earliestScoreDate, trimmedToScoreWindow: earliestScoreDay > earliestPriceDay };
}
