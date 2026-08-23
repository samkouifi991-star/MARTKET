// Historical reliability multiplier (requirement #20's "use historical
// reliability as a slow-moving multiplier, not an aggressively self-
// optimizing weight"). Deliberately conservative by construction: a hard
// cap on how far the multiplier can move away from 1.0, and a real minimum
// sample size before it moves at all — this is how "avoid overfitting" is
// enforced structurally, not just by intent.
//
// No real historical-reliability data source is wired into engine.ts yet —
// that requires scripts/backtest-v2-factors.ts (a later milestone) to
// accumulate genuine forward-return samples in scoringShadowComparisons/
// marketScoresV2 first, which takes real elapsed time, not just more code.
// Until then every call site passes `null`, and this function honestly
// returns the neutral 1.0 multiplier — never a fabricated "reliable"
// or "unreliable" read from a sample that doesn't exist.
export type ReliabilityStats = { sampleSize: number; hitRate: number }; // hitRate: fraction correct-direction, 0..1

const MIN_SAMPLE_SIZE = 30;
const MAX_ADJUSTMENT = 0.15; // the multiplier can move at most +-15% from 1.0

export function reliabilityMultiplier(stats: ReliabilityStats | null): number {
  if (!stats || stats.sampleSize < MIN_SAMPLE_SIZE) return 1.0;
  const edge = (stats.hitRate - 0.5) * 2; // -1 (always wrong) .. 0 (coin flip) .. 1 (always right)
  const multiplier = 1 + edge * MAX_ADJUSTMENT;
  return Math.max(1 - MAX_ADJUSTMENT, Math.min(1 + MAX_ADJUSTMENT, Number(multiplier.toFixed(4))));
}
