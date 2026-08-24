// Scoring Engine V2's behavior-tuning configuration — the domain-typed
// counterpart to schema.ts's scoringConfigurations.v2Settings jsonb column
// (see db/queries/scoring-config.ts's serialize/deserialize pattern for
// biasThresholds, which this mirrors). Versioned in the SAME row as V1's
// weights/thresholds so one "Save & Version" saves the complete model
// (requirement #24), but kept as its own type here — V1's BiasThreshold/
// DEFAULT_FACTOR_WEIGHTS in lib/config.ts are untouched.
import { Bias } from "@/lib/types";
import { FamilyCap } from "./factor-families";

export type ImportanceTier = "HIGH" | "MEDIUM" | "LOW";

export type EventShockConfig = {
  // Hard cap on any single event shock's initial contribution (points, on
  // the shared -10..10 scale) — requirement #24's "event-shock maximum
  // contribution".
  maxContribution: number;
  // Decay half-life in hours, per importance tier — HIGH events (FOMC/CPI/
  // NFP/GDP) persist longest per requirement #8's explicit example.
  decayHalfLifeHoursByTier: Record<ImportanceTier, number>;
};

// Entry/exit pair for one bias tier's hysteresis band (requirement #15).
// Neutral has no entry/exit of its own — it's simply "whichever band isn't
// currently active for Bullish/Bearish".
export type HysteresisThreshold = { bias: Bias; enter: number; exit: number };

export type ScoringV2Settings = {
  eventShock: EventShockConfig;
  // 0-100 — Very Bullish/Very Bearish additionally require confidence at
  // or above this (requirement #14).
  minConfidenceForExtreme: number;
  hysteresis: HysteresisThreshold[];
  familyCaps: FamilyCap[];
  // Default smoothing strength (requirement #16): smoothed = alpha*new +
  // (1-alpha)*previous. Closer to 1 = less smoothing = more immediate.
  smoothingAlpha: number;
  // Used instead of smoothingAlpha for a cycle in which a HIGH-impact event
  // fired — closer to 1 so a genuine surprise can still move the score
  // quickly even with smoothing enabled.
  smoothingAlphaHighImpact: number;
};

export const DEFAULT_SCORING_V2_SETTINGS: ScoringV2Settings = {
  eventShock: {
    maxContribution: 3,
    decayHalfLifeHoursByTier: { HIGH: 36, MEDIUM: 12, LOW: 3 },
  },
  minConfidenceForExtreme: 60,
  hysteresis: [
    { bias: "Very Bullish", enter: 8, exit: 6.5 },
    { bias: "Bullish", enter: 4, exit: 3 },
    { bias: "Bearish", enter: -4, exit: -3 },
    { bias: "Very Bearish", enter: -8, exit: -6.5 },
  ],
  familyCaps: [
    { family: "Macro", maxContribution: 6 },
    { family: "Positioning", maxContribution: 4 },
    { family: "Technical", maxContribution: 4 },
    { family: "Event", maxContribution: 3 },
  ],
  smoothingAlpha: 0.5,
  smoothingAlphaHighImpact: 0.85,
};
