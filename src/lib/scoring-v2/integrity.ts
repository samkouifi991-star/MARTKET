// Score integrity engine — validates a fully-computed V2 score BEFORE it is
// ever written to current_market_scores_v2/current_factor_scores_v2
// (requirement #19). A failure here must never publish a broken
// calculation: the caller (engine.ts) keeps the previous canonical row and
// records the failure in scoring_integrity_errors for Admin visibility.
import { DataFreshness, ScoreFactor } from "@/lib/types";

export type IntegrityCheckInput = {
  totalScore: number;
  factors: ScoreFactor[];
  confidence: number;
  scoringVersionId: number | null;
  bootstrapConfigAllowed: boolean; // true when running on hardcoded defaults is an acceptable (not an error) state
};

export type IntegrityResult = { valid: true } | { valid: false; errors: string[] };

const VALID_FRESHNESS: Set<DataFreshness> = new Set(["live", "delayed", "estimated", "stale", "unavailable", "error", "not_applicable"]);

export function validateScoreIntegrity(input: IntegrityCheckInput): IntegrityResult {
  const errors: string[] = [];

  if (Number.isNaN(input.totalScore)) errors.push("totalScore is NaN");
  if (input.totalScore < -10 || input.totalScore > 10) errors.push(`totalScore ${input.totalScore} is outside [-10, 10]`);
  if (Number.isNaN(input.confidence)) errors.push("confidence is NaN");
  if (input.confidence < 0 || input.confidence > 100) errors.push(`confidence ${input.confidence} is outside [0, 100]`);

  if (input.scoringVersionId === undefined) errors.push("scoringVersionId is undefined (must be a number or explicit null for bootstrap defaults)");
  if (input.scoringVersionId === null && !input.bootstrapConfigAllowed) errors.push("scoringVersionId is null but bootstrap defaults are not marked as allowed for this computation");

  if (input.factors.length === 0) {
    errors.push("no factors present — a score with zero contributing factors cannot be published");
  } else {
    const sum = Number(input.factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
    const rounded = Number(input.totalScore.toFixed(2));
    if (Math.abs(sum - rounded) > 0.01) errors.push(`totalScore (${rounded}) does not equal the sum of visible factor contributions (${sum})`);

    for (const f of input.factors) {
      if (Number.isNaN(f.contribution) || Number.isNaN(f.rawScore)) errors.push(`factor ${f.key} has a NaN contribution or rawScore`);
      if ((f.freshness === "unavailable" || f.freshness === "error") && f.contribution !== 0) {
        errors.push(`factor ${f.key} is ${f.freshness} but contributes ${f.contribution} (unavailable/error contributions must be exactly 0)`);
      }
      if (!VALID_FRESHNESS.has(f.freshness)) errors.push(`factor ${f.key} has an invalid freshness value: ${String(f.freshness)}`);
      if (!f.lastUpdated) errors.push(`factor ${f.key} is missing lastUpdated`);
      if (!f.nextUpdate) errors.push(`factor ${f.key} is missing nextUpdate`);
      if (!f.source) errors.push(`factor ${f.key} is missing a source (provenance)`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
