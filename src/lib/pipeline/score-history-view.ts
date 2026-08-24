// Pure display-layer helpers for ScoreHistoryChart (components/charts/
// ScoreHistoryChart.tsx) — extracted from that .tsx file purely so this
// logic can be unit-tested (this repo's vitest config only picks up
// src/**/*.test.ts, not .tsx). Never touches the append-only score-history
// storage itself; this only reduces what gets CHARTED.
import { ScoreHistoryPoint } from "@/lib/types";

// Below this many distinct legitimate (deduped) observations, a chart
// stretched across the usual 5-month window is misleading — a handful of
// points spread across a fake-wide axis reads as "flat" or looks like
// fabricated history, when it's really just a market whose real tracking
// only recently started (see GBPJPY: genuine append-only history, just
// young). Matches the spec's "~7 legitimate observations" floor.
export const MIN_LEGITIMATE_OBSERVATIONS = 7;

/**
 * Same-day repeated computations (multiple cron/admin recompute runs on
 * one calendar date) previously showed as several near-identical points
 * with a repeated x-axis label — collapses each calendar date down to its
 * single latest legitimate observation, exactly the same "latest wins"
 * rule the rest of this project's storage-first architecture already
 * applies elsewhere (see last-known-good.ts). Returns points sorted
 * ascending by date, one per distinct calendar day.
 */
export function dedupeScoreHistoryByDate(history: ScoreHistoryPoint[]): ScoreHistoryPoint[] {
  const latestByDate = new Map<string, ScoreHistoryPoint>();
  for (const point of history) {
    const day = point.date.slice(0, 10);
    const existing = latestByDate.get(day);
    if (!existing || new Date(point.date).getTime() >= new Date(existing.date).getTime()) {
      latestByDate.set(day, point);
    }
  }
  return [...latestByDate.values()].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
