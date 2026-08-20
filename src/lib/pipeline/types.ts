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

// Shared freshness-combining helpers — used wherever a factor/card's badge
// must reflect the worse of two independent degradations (e.g. price card's
// quote + daily-candle freshness, or seasonality's data-recency + sample-depth
// freshness). unavailable/error rank above stale since they mean "nothing
// usable at all," strictly worse than "usable but old/thin."
const FRESHNESS_RANK: Record<DataFreshness, number> = {
  live: 0,
  delayed: 1,
  estimated: 1,
  stale: 2,
  unavailable: 3,
  error: 3,
};

export function worseOf(a: DataFreshness, b: DataFreshness): DataFreshness {
  return FRESHNESS_RANK[b] > FRESHNESS_RANK[a] ? b : a;
}

/** Classifies seasonality's historical sample depth into the same freshness
 * vocabulary the rest of the app already uses for recency, so a thin sample
 * degrades the badge exactly like stale data would — reduced confidence,
 * not a fabricated multi-year read:
 *   < 3 years  -> unavailable (too thin to be more than noise)
 *   3-5 years  -> stale       (usable, low confidence)
 *   5-10 years -> delayed     (usable, reduced confidence)
 *   10+ years  -> live        (normal confidence) */
export function seasonalityDepthFreshness(yearsSpanned: number): DataFreshness {
  if (yearsSpanned < 3) return "unavailable";
  if (yearsSpanned < 5) return "stale";
  if (yearsSpanned < 10) return "delayed";
  return "live";
}
