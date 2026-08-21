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
  not_applicable: 0, // unused — not_applicable factors are excluded below, never averaged in
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function computeConfidence(factors: ResolvedFactor[]): number {
  // not_applicable factors (e.g. no CFTC contract for this asset, no
  // retail-sentiment provider for this asset class) are a permanent,
  // by-design gap, not a data-quality problem — an asset with fewer
  // structurally-applicable factors must not be penalized versus one that
  // has all nine. Confidence is computed only over the applicable set.
  const applicable = factors.filter((f) => f.freshness !== "not_applicable");
  if (applicable.length === 0) return 0;

  const available = applicable.filter((f) => f.freshness !== "unavailable" && f.freshness !== "error");
  const completeness = available.length / applicable.length;

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

  const freshnessScore = applicable.reduce((s, f) => s + FRESHNESS_WEIGHT[f.freshness], 0) / applicable.length;

  // No flat baseline: confidence must be able to fall close to the floor
  // when almost nothing is available, not just dip modestly.
  const base = completeness * 40 + freshnessScore * 30 + agreement * 25;
  return Math.round(clamp(base, 5, 97));
}
