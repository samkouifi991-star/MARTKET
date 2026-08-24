// Hysteresis — prevents a score hovering near a threshold from flipping
// bias back and forth on every tiny update (requirement #15). A market
// already classified Bullish stays Bullish until the score drops below the
// (lower) EXIT threshold, not the (higher) ENTRY threshold it needed to
// cross to become Bullish in the first place.
import { Bias } from "@/lib/types";
import { HysteresisThreshold } from "./config";

const NEUTRAL: Bias = "Neutral";

function thresholdFor(thresholds: HysteresisThreshold[], bias: Bias): HysteresisThreshold | undefined {
  return thresholds.find((t) => t.bias === bias);
}

/** previousBias is the bias this SAME symbol carried after its last V2
 * computation (null on the very first computation — no history to anchor
 * to yet, so this falls back to plain threshold classification). */
export function classifyBiasWithHysteresis(score: number, previousBias: Bias | null, thresholds: HysteresisThreshold[]): Bias {
  const veryBullish = thresholdFor(thresholds, "Very Bullish");
  const bullish = thresholdFor(thresholds, "Bullish");
  const bearish = thresholdFor(thresholds, "Bearish");
  const veryBearish = thresholdFor(thresholds, "Very Bearish");

  // No prior state (or a missing threshold config) — a plain one-shot
  // classification using each tier's ENTER value, same shape as v1's
  // classifyBias but reading from the hysteresis config's entry side.
  if (!previousBias || !veryBullish || !bullish || !bearish || !veryBearish) {
    if (veryBullish && score >= veryBullish.enter) return "Very Bullish";
    if (bullish && score >= bullish.enter) return "Bullish";
    if (veryBearish && score <= veryBearish.enter) return "Very Bearish";
    if (bearish && score <= bearish.enter) return "Bearish";
    return NEUTRAL;
  }

  switch (previousBias) {
    case "Very Bullish":
      if (score >= veryBullish.exit) return "Very Bullish";
      if (score >= bullish.enter) return "Bullish";
      break;
    case "Bullish":
      if (score >= veryBullish.enter) return "Very Bullish";
      if (score >= bullish.exit) return "Bullish";
      break;
    case "Very Bearish":
      if (score <= veryBearish.exit) return "Very Bearish";
      if (score <= bearish.enter) return "Bearish";
      break;
    case "Bearish":
      if (score <= veryBearish.enter) return "Very Bearish";
      if (score <= bearish.exit) return "Bearish";
      break;
    case "Neutral":
      break;
  }

  // Fell out of the previous band (or was already Neutral) — re-classify
  // fresh from entry thresholds, checking the more extreme tiers first.
  if (score >= veryBullish.enter) return "Very Bullish";
  if (score >= bullish.enter) return "Bullish";
  if (score <= veryBearish.enter) return "Very Bearish";
  if (score <= bearish.enter) return "Bearish";
  return NEUTRAL;
}
