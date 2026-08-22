// The scoring engine's view of "which weights/thresholds are active right
// now" — reads the saved configuration from Neon (see db/queries/
// scoring-config.ts), falling back to the hardcoded bootstrap defaults in
// lib/config.ts only when no configuration has ever been saved, or on a DB
// read failure (best-effort, matching this codebase's rule that a Neon
// outage must never break score computation or serving).
import { getActiveScoringConfiguration } from "@/db/queries/scoring-config";
import { DEFAULT_FACTOR_WEIGHTS, DEFAULT_BIAS_THRESHOLDS, BiasThreshold } from "@/lib/config";
import { ScoreFactorKey } from "@/lib/types";

export type ResolvedScoringConfig = {
  // null when running on the bootstrap defaults — no scoring_configurations
  // row exists (or the read failed) to attribute this computation to.
  id: number | null;
  weights: Record<ScoreFactorKey, number>;
  biasThresholds: BiasThreshold[];
  // ISO timestamp the active row was saved, or null on the bootstrap
  // defaults (never saved). Optional so existing literals built for
  // computeLiveMarketScore's scoringConfig option (which only cares about
  // id/weights/biasThresholds) don't need updating.
  updatedAt?: string | null;
};

const BOOTSTRAP_CONFIG: ResolvedScoringConfig = { id: null, weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: DEFAULT_BIAS_THRESHOLDS, updatedAt: null };

export async function resolveActiveScoringConfig(): Promise<ResolvedScoringConfig> {
  try {
    const active = await getActiveScoringConfiguration();
    if (!active) return BOOTSTRAP_CONFIG;
    return { id: active.id, weights: active.weights, biasThresholds: active.biasThresholds, updatedAt: active.createdAt.toISOString() };
  } catch {
    return BOOTSTRAP_CONFIG;
  }
}
