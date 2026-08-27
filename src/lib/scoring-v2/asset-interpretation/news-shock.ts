// Maps an LLM-classified geopolitical/monetary-policy news item into an
// initial event-shock contribution, on the SAME -10..10 scale every other
// asset-interpretation module uses (fx.ts/gold.ts/indices.ts/crypto.ts) so
// it decays and family-caps identically through the existing engine — no
// new scoring math, no schema change (eventShocks.sourceReleaseId is
// already nullable; recordEventShock is called with null here since no
// economic release backs a news-driven shock).
import { ImportanceTier } from "@/services/economic-calendar/indicator-taxonomy";
import { LlmNewsClassification } from "@/lib/engines/llm-news-classifier";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

/** Deliberately conservative: "Mixed"/"Neutral"/"Unclear" always produce
 * 0 (no shock recorded at all) — matches the existing V2 posture that a
 * bad/ambiguous signal must not fabricate a strong score move. Magnitude
 * scales down with BOTH importance and confidence, so a low-confidence
 * high-importance guess still produces a small shock, never a large one. */
export function computeNewsShockContribution(c: LlmNewsClassification): number {
  if (c.interpretation !== "Bullish" && c.interpretation !== "Bearish") return 0;
  const sign = c.interpretation === "Bullish" ? 1 : -1;
  const magnitude = (c.importance / 100) * (c.confidence / 100) * 10;
  return clamp(sign * magnitude);
}

/** LOW-tier relevance is filtered out before ever calling recordEventShock
 * (matches how importance-tiering gates every other shock source). */
export function mapRelevanceToTier(c: LlmNewsClassification): ImportanceTier {
  const relevance = Math.max(c.geopoliticalRelevance, c.monetaryPolicyRelevance);
  if (relevance >= 70) return "HIGH";
  if (relevance >= 40) return "MEDIUM";
  return "LOW";
}
