// Economic surprise engine (requirements #3 and #4). A raw actual-minus-
// forecast difference means completely different things for different
// indicators (0.2% is huge for CPI, negligible for payrolls) — this module
// normalizes by each indicator's OWN historical surprise distribution
// (surpriseZ), and separately accounts for prior-period revisions
// (effectiveSurprise), before anything reaches the event-shock layer.
export type SurpriseTier = "minor" | "moderate" | "significant" | "major";

export function computeSurprise(actual: number, forecast: number | null): number | null {
  if (forecast === null) return null;
  return Number((actual - forecast).toFixed(4));
}

/** Payrolls example from the spec: +220K vs +180K expected looks strongly
 * positive, but if the prior two months were revised down 100K combined,
 * the effective surprise should be weaker. A downward revision
 * (revisedPrevious < previous) produces a negative adjustment; an upward
 * revision strengthens the effective surprise instead. Honestly 0 when no
 * revision data exists (revisedPrevious is null) — never assumed. */
export function computeRevisionAdjustment(previous: number | null, revisedPrevious: number | null): number {
  if (previous === null || revisedPrevious === null) return 0;
  return Number((revisedPrevious - previous).toFixed(4));
}

export function computeEffectiveSurprise(surprise: number | null, revisionAdjustment: number): number | null {
  if (surprise === null) return null;
  return Number((surprise + revisionAdjustment).toFixed(4));
}

// Clamp bound: prevents one bad print (or a data error) from producing an
// unbounded z-score that would dominate the rest of the composite.
const MAX_ABS_Z = 4;

// A rolling per-indicator distribution needs a real minimum sample before
// normalizing means anything — fewer observations than this returns null
// (honest "not enough history yet"), never a fabricated z-score.
const MIN_SAMPLE_FOR_NORMALIZATION = 4;

export type HistoricalDistribution = { mean: number; stdDev: number; sampleSize: number };

/** pastEffectiveSurprises should be real stored observations for the SAME
 * indicator+country (see db/queries/economic-releases.ts), oldest bias
 * excluded by the caller if desired — this function just computes mean/
 * variance over whatever real sample it's given. */
export function computeHistoricalDistribution(pastEffectiveSurprises: number[]): HistoricalDistribution | null {
  if (pastEffectiveSurprises.length < MIN_SAMPLE_FOR_NORMALIZATION) return null;
  const mean = pastEffectiveSurprises.reduce((s, v) => s + v, 0) / pastEffectiveSurprises.length;
  const variance = pastEffectiveSurprises.reduce((s, v) => s + (v - mean) ** 2, 0) / pastEffectiveSurprises.length;
  return { mean, stdDev: Math.sqrt(variance), sampleSize: pastEffectiveSurprises.length };
}

export function computeSurpriseZ(effectiveSurprise: number, distribution: HistoricalDistribution | null): number | null {
  if (!distribution || distribution.stdDev <= 1e-9) return null;
  const z = (effectiveSurprise - distribution.mean) / distribution.stdDev;
  return Math.max(-MAX_ABS_Z, Math.min(MAX_ABS_Z, Number(z.toFixed(3))));
}

/** Suggested interpretation bands from the spec: |Z|<0.5 minor, 0.5-1
 * moderate, 1-2 significant, >2 major. */
export function surpriseTier(z: number): SurpriseTier {
  const abs = Math.abs(z);
  if (abs > 2) return "major";
  if (abs >= 1) return "significant";
  if (abs >= 0.5) return "moderate";
  return "minor";
}
