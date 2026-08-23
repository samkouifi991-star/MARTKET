// Exponential smoothing — dampens noisy single-cycle swings (the "+6 -> +1
// -> +6 within minutes" scenario, requirement #16) while still letting a
// genuine HIGH-impact economic surprise move the score quickly by using a
// much less aggressive alpha for that cycle.
export function smoothedScore(newRaw: number, previousSmoothed: number | null, alpha: number): number {
  // No prior smoothed value (first computation for this symbol) — nothing
  // to blend with, so the raw score IS the smoothed score.
  if (previousSmoothed === null) return newRaw;
  const a = Math.max(0, Math.min(1, alpha));
  return Number((a * newRaw + (1 - a) * previousSmoothed).toFixed(4));
}

/** Picks which alpha applies this cycle — the immediacy-favoring
 * `alphaHighImpact` when a HIGH-impact event fired, otherwise the default
 * `alpha`. A separate, tiny function so engine.ts's call site reads as one
 * clear decision rather than an inline ternary repeated at every call site. */
export function selectSmoothingAlpha(hadHighImpactEventThisCycle: boolean, alpha: number, alphaHighImpact: number): number {
  return hadHighImpactEventThisCycle ? alphaHighImpact : alpha;
}
