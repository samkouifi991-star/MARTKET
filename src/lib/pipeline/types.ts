import { DataFreshness, ScoreFactorKey } from "@/lib/types";
import { DataMode } from "@/services/data-mode";

// The shape every factor resolver in src/lib/pipeline/* must return. This is
// the "factor engine" stage of External API -> raw storage -> normalization
// -> factor engine -> weighted score -> market score -> UI: resolvers are
// the only place allowed to decide live-vs-demo-vs-unavailable for a single
// factor. Nothing downstream (scoring engine, DB writer, UI) re-derives this.
export type ResolvedFactor = {
  key: ScoreFactorKey;
  rawScore: number; // -10..10, or 0 when status is unavailable/error
  explanation: string;
  source: string;
  provider: string;
  freshness: DataFreshness;
  lastUpdated: string; // ISO
  nextUpdate: string; // ISO
};

export function unavailableFactor(key: ScoreFactorKey, source: string, reason: string): ResolvedFactor {
  const now = new Date().toISOString();
  return {
    key,
    rawScore: 0,
    explanation: `Data temporarily unavailable: ${reason}`,
    source,
    provider: "none",
    freshness: "unavailable",
    lastUpdated: now,
    nextUpdate: now,
  };
}

export function errorFactor(key: ScoreFactorKey, source: string, error: string): ResolvedFactor {
  const now = new Date().toISOString();
  return {
    key,
    rawScore: 0,
    explanation: `Data temporarily unavailable: request failed (${error}).`,
    source,
    provider: "none",
    freshness: "error",
    lastUpdated: now,
    nextUpdate: now,
  };
}

/** Marks a factor that came from the demo generator while running in hybrid
 * mode — distinct from "estimated" (a deliberately-approximate real-world
 * proxy); this is synthetic demo data standing in until live data lands. */
export function demoFallbackFactor(base: Omit<ResolvedFactor, "freshness" | "provider">): ResolvedFactor {
  return { ...base, provider: "demo", freshness: "estimated" };
}

export type FactorResolverContext = {
  symbol: string;
  mode: DataMode;
};
