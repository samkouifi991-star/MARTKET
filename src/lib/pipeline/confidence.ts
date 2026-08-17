// Confidence engine — how much to trust a total score, independent of its
// magnitude. Extends the demo confidence model (agreement + freshness) with
// explicit handling for the live-pipeline statuses: an unavailable/error
// factor must pull confidence down hard, not just "count as noise", per the
// spec's "a missing factor should lower confidence" requirement.
import { ResolvedFactor } from "./types";

const FRESHNESS_WEIGHT: Record<ResolvedFactor["freshness"], number> = {
  live: 1,
  delayed: 0.75,
  estimated: 0.55,
  stale: 0.3,
  unavailable: 0.1,
  error: 0.1,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeConfidence(factors: ResolvedFactor[]): number {
  if (factors.length === 0) return 0;

  const available = factors.filter((f) => f.freshness !== "unavailable" && f.freshness !== "error");
  const completeness = available.length / factors.length;

  // Agreement is only meaningful across factors that actually have data —
  // an all-unavailable set has rawScore=0 by convention, which is a
  // placeholder, not real consensus, and must not read as "perfect agreement".
  let agreement = 0;
  if (available.length > 0) {
    const scores = available.map((f) => f.rawScore);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    agreement = Math.max(0, 1 - Math.sqrt(variance) / 10);
  }

  const freshnessScore = factors.reduce((s, f) => s + FRESHNESS_WEIGHT[f.freshness], 0) / factors.length;

  // No flat baseline: confidence must be able to fall close to the floor
  // when almost nothing is available, not just dip modestly.
  const base = completeness * 40 + freshnessScore * 30 + agreement * 25;
  return Math.round(clamp(base, 5, 97));
}
