// Pre-launch value pass — shared, zero-new-query presentation helpers for
// "what's driving this market right now" and "did this just become
// notable." Both are derived entirely from fields Dashboard/Top Setups
// already load on every render (MarketScore.factors, .totalScore,
// .change24h) — no new provider calls, no new DB reads, no LLM. Extracted
// to its own file (not a .tsx component) so the derivation logic itself is
// unit-testable under this repo's vitest config (src/**/*.test.ts only).
import { MarketScore, ScoreFactor, FACTOR_LABELS } from "./types";
import { DEFAULT_BIAS_THRESHOLDS, classifyBias } from "./config";

// Below this |contribution|, a factor's pull on the total score is small
// enough that naming it as "the catalyst" would overstate its role.
const MIN_CATALYST_CONTRIBUTION = 0.2;

/** Top 1-2 factors by |contribution| (above MIN_CATALYST_CONTRIBUTION),
 * named plainly — e.g. "Institutional positioning (bullish) + Technical
 * trend (bullish)". Deliberately does not paraphrase or shorten each
 * factor's own `explanation` text into new prose (that would risk
 * generating a reason the underlying data doesn't actually support) —
 * this only names WHICH already-computed factors are driving the score
 * and in which direction, both real fields on the factor itself. */
export function buildCatalyst(factors: ScoreFactor[]): string | null {
  const ranked = [...factors]
    .filter((f) => Math.abs(f.contribution) >= MIN_CATALYST_CONTRIBUTION)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2);
  if (ranked.length === 0) return null;
  return ranked.map((f) => `${FACTOR_LABELS[f.key]} (${f.contribution >= 0 ? "bullish" : "bearish"})`).join(" + ");
}

/** Honest, cheap "just became notable" definition per the product-value
 * pass: qualifies as NEW when the market's CURRENT bias is directional
 * (not Neutral) but its bias 24h ago — reconstructed as
 * totalScore - change24h, reclassified with the same threshold table —
 * was Neutral. Uses only fields already on every MarketScore (no score-
 * history read, no new DB table for "was this in yesterday's top-N list").
 * Reclassifying the 24h-ago score against DEFAULT_BIAS_THRESHOLDS (not
 * necessarily today's live Admin-configured thresholds, which aren't
 * available to every caller of this function) is a deliberate, documented
 * approximation — see the pre-launch audit for why this is preferred over
 * adding new DB infrastructure just to track literal list membership. */
export function isNewSetup(score: Pick<MarketScore, "totalScore" | "change24h">): boolean {
  const previousScore = score.totalScore - score.change24h;
  const currentBias = classifyBias(score.totalScore, DEFAULT_BIAS_THRESHOLDS);
  const previousBias = classifyBias(previousScore, DEFAULT_BIAS_THRESHOLDS);
  return currentBias !== "Neutral" && previousBias === "Neutral";
}
