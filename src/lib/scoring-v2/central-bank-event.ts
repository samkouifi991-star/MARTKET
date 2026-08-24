// Central bank event engine (requirement #23). Rate decisions need special
// treatment beyond a generic actual-vs-forecast surprise: an unchanged rate
// with unexpectedly dovish guidance can move markets as much as a surprise
// cut. Rate Decision Shock and Forward Guidance Shock are computed and
// stored separately so each can be attributed independently (see
// attribution.ts, a later milestone) instead of being blended into one
// opaque number.
//
// Guidance sentiment has no dedicated structured data source in this
// codebase (no vendor here parses FOMC statement text, dot plots, or
// press-conference transcripts into a sentiment score) — rather than
// fabricate an NLP model, this reuses the EXISTING, real news-intelligence
// pipeline's tagged coverage of the relevant central bank around the
// decision window (pipeline/news.ts's already-real NewsImpact/importance/
// confidence classification). This is an honest, real-but-approximate
// proxy, documented as such — not a bespoke sentiment model over raw text.
import { NewsImpact } from "@/lib/types";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// Scaled so a 25bp (0.25) surprise vs. expectations produces a moderate,
// not overwhelming, shock — central bank surprises of that size are
// meaningful but rarely the sole driver of a multi-point score swing.
const RATE_SURPRISE_SCALE = 8;

/** actualRate/expectedRate in the same units (e.g. percent) — a cut
 * relative to what was priced in produces a negative (bearish-for-the-
 * currency, generically) shock; a hike relative to expectations produces a
 * positive one. Asset-specific interpretation (e.g. Gold treats a hawkish
 * surprise as bearish for the metal) happens downstream in
 * asset-interpretation/*, not here — this only measures the raw magnitude
 * and direction of the decision itself. */
export function computeRateDecisionShock(actualRate: number, expectedRate: number): number {
  return clamp((actualRate - expectedRate) * RATE_SURPRISE_SCALE);
}

export type GuidanceNewsSignal = { interpretation: NewsImpact; importance: number; confidence: number };

const SIGN_MAP: Record<NewsImpact, number> = { Bullish: 1, Bearish: -1, Mixed: 0, Neutral: 0, Unclear: 0 };

/** Weighted average of importance*confidence-weighted news signals tagged
 * to the relevant central bank around the decision window — the same
 * weighting scheme lib/scoring.ts's newsFactor already uses, reused here
 * rather than reinvented. Returns 0 (not null) when no relevant coverage
 * exists this cycle — "no guidance shock detected" is a legitimate, common
 * state, not a data-quality gap. */
export function computeForwardGuidanceShock(signals: GuidanceNewsSignal[], scale = 3): number {
  if (signals.length === 0) return 0;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of signals) {
    const weight = (s.importance / 100) * (s.confidence / 100);
    weightedSum += SIGN_MAP[s.interpretation] * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0;
  return clamp((weightedSum / weightTotal) * scale);
}

export type CentralBankEventResult = { rateDecisionShock: number; forwardGuidanceShock: number };

export function computeCentralBankEvent(actualRate: number | null, expectedRate: number | null, guidanceSignals: GuidanceNewsSignal[]): CentralBankEventResult {
  const rateDecisionShock = actualRate !== null && expectedRate !== null ? computeRateDecisionShock(actualRate, expectedRate) : 0;
  const forwardGuidanceShock = computeForwardGuidanceShock(guidanceSignals);
  return { rateDecisionShock, forwardGuidanceShock };
}
