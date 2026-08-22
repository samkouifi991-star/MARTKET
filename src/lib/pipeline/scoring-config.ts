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
};

const BOOTSTRAP_CONFIG: ResolvedScoringConfig = { id: null, weights: DEFAULT_FACTOR_WEIGHTS, biasThresholds: DEFAULT_BIAS_THRESHOLDS };

export async function resolveActiveScoringConfig(): Promise<ResolvedScoringConfig> {
  try {
    const active = await getActiveScoringConfiguration();
    if (!active) return BOOTSTRAP_CONFIG;
    return { id: active.id, weights: active.weights, biasThresholds: active.biasThresholds };
  } catch {
    return BOOTSTRAP_CONFIG;
  }
}
