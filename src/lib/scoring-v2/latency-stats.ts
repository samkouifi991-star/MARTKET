// Provider-latency monitoring (requirement #10) — median/P95 detection
// latency (scheduled release time -> the moment a watcher run first saw
// `actual` become non-null), grouped by indicator. Pure math over rows
// db/queries/release-tracking.ts's getLatencySamples already filtered down
// to ones with a real firstDetectedAt; this module never touches the
// database itself.
import { EconomicIndicatorKey } from "@/services/economic-calendar/indicator-taxonomy";

export type LatencySample = { indicatorKey: EconomicIndicatorKey; scheduledAt: string; firstDetectedAt: string };

export type LatencyStat = { indicatorKey: EconomicIndicatorKey; sampleSize: number; medianMs: number; p95Ms: number };

// Honest "not enough real data yet" floor — a single sample's "median"
// would be meaningless as a monitoring signal.
const MIN_SAMPLE_SIZE = 3;

function percentile(sortedMs: number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

/** Groups real samples by indicator and computes median/P95 latency in
 * milliseconds. An indicator with fewer than MIN_SAMPLE_SIZE real samples
 * is excluded entirely (never a fabricated stat from too little data),
 * sorted by sample size descending so the best-observed indicators surface
 * first in the Admin card. */
export function computeLatencyStats(samples: LatencySample[]): LatencyStat[] {
  const byIndicator = new Map<EconomicIndicatorKey, number[]>();
  for (const s of samples) {
    const ms = new Date(s.firstDetectedAt).getTime() - new Date(s.scheduledAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) continue; // a detection before the scheduled time is a data anomaly, not a real latency sample
    const list = byIndicator.get(s.indicatorKey) ?? [];
    list.push(ms);
    byIndicator.set(s.indicatorKey, list);
  }

  const stats: LatencyStat[] = [];
  for (const [indicatorKey, values] of byIndicator) {
    if (values.length < MIN_SAMPLE_SIZE) continue;
    const sorted = [...values].sort((a, b) => a - b);
    stats.push({ indicatorKey, sampleSize: sorted.length, medianMs: percentile(sorted, 50), p95Ms: percentile(sorted, 95) });
  }

  return stats.sort((a, b) => b.sampleSize - a.sampleSize);
}
