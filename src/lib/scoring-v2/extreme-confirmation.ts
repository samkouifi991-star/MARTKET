// Requires broad, independent confirmation before labeling a market Very
// Bullish/Very Bearish — a single oversized factor must not be enough
// (requirement #14). "Independent" means independent FAMILIES (Macro,
// Positioning, Technical, Event — see factor-families.ts), not independent
// individual factors, since e.g. CPI+PPI+rates are all the same Macro story.
import { Bias } from "@/lib/types";
import { FactorFamily } from "./factor-families";

export type FamilyDirection = { family: FactorFamily; contribution: number };

const MIN_SUPPORTING_FAMILIES = 3;

function countSupportingFamilies(families: FamilyDirection[], wantPositive: boolean): number {
  // A family only "supports" a direction if its net contribution is
  // meaningfully non-zero in that direction — a family sitting at ~0 isn't
  // evidence for either side.
  const threshold = 0.15;
  return families.filter((f) => (wantPositive ? f.contribution >= threshold : f.contribution <= -threshold)).length;
}

/** Given a proposed bias (already computed by classifyBiasWithHysteresis)
 * and the confidence/family breakdown behind it, downgrades Very Bullish ->
 * Bullish (or Very Bearish -> Bearish) when confirmation requirements
 * aren't met. Never upgrades a bias, and never touches Neutral/Bullish/
 * Bearish — only the two extreme tiers require confirmation. */
export function confirmExtremeBias(proposedBias: Bias, confidence: number, families: FamilyDirection[], minConfidence: number): Bias {
  if (proposedBias === "Very Bullish") {
    const supporting = countSupportingFamilies(families, true);
    if (confidence >= minConfidence && supporting >= MIN_SUPPORTING_FAMILIES) return "Very Bullish";
    return "Bullish";
  }
  if (proposedBias === "Very Bearish") {
    const supporting = countSupportingFamilies(families, false);
    if (confidence >= minConfidence && supporting >= MIN_SUPPORTING_FAMILIES) return "Very Bearish";
    return "Bearish";
  }
  return proposedBias;
}
