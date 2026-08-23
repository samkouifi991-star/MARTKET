// Confidence engine V2 (requirement #13) — extends pipeline/confidence.ts's
// coverage/freshness/agreement model (unchanged, still used by V1) with
// provider quality, reliability.ts's slow-moving multiplier, and
// regime.ts's clarity score, so "Score +7.2 / Confidence 42%" and
// "Score +7.2 / Confidence 91%" can genuinely mean very different things.
import { ResolvedFactor } from "@/lib/pipeline/types";
import { MacroRegime, RegimeInputs, regimeClarity } from "./regime";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const FRESHNESS_WEIGHT: Record<ResolvedFactor["freshness"], number> = {
  live: 1,
  delayed: 0.75,
  estimated: 0.55,
  stale: 0.3,
  unavailable: 0.1,
  error: 0.1,
  not_applicable: 0, // unused — not_applicable factors are excluded below, never averaged in
};

// Rough tiers reflecting how directly each provider observes what it
// reports vs. estimates/derives it — official government/exchange data
// (FRED, CFTC) and broker-direct feeds (OANDA) rank highest; FMP (a
// third-party aggregator) ranks slightly below; demo/unknown rank lowest.
// Not a precision science — this is a coarse, documented input among
// several, not the sole driver of confidence.
const PROVIDER_QUALITY: Record<string, number> = { fred: 1.0, cftc: 1.0, oanda: 0.95, ig: 0.9, myfxbook: 0.85, fmp: 0.85, demo: 0.5, none: 0.3, unknown: 0.6 };

function providerQualityOf(provider: string | undefined): number {
  return PROVIDER_QUALITY[provider ?? "unknown"] ?? 0.6;
}

export type ConfidenceV2Input = {
  factors: ResolvedFactor[];
  // One reliability.ts multiplier per contributing factor (see
  // reliability.ts) — typically all 1.0 today since no real historical
  // sample exists yet; wired here so confidence responds automatically
  // once that data accumulates, with no call-site changes needed later.
  reliabilityMultipliers: number[];
  regime: MacroRegime;
  regimeInputs: RegimeInputs;
};

export function computeConfidenceV2({ factors, reliabilityMultipliers, regime, regimeInputs }: ConfidenceV2Input): number {
  // not_applicable factors are a permanent, by-design gap (matches
  // pipeline/confidence.ts's identical rule) — excluded entirely, never
  // penalized as if they were a data-quality problem.
  const applicable = factors.filter((f) => f.freshness !== "not_applicable");
  if (applicable.length === 0) return 0;

  const available = applicable.filter((f) => f.freshness !== "unavailable" && f.freshness !== "error");
  const completeness = available.length / applicable.length;

  let agreement = 0;
  if (available.length > 0) {
    const scores = available.map((f) => f.rawScore);
    const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
    const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
    agreement = Math.max(0, 1 - Math.sqrt(variance) / 10);
  }

  const freshnessScore = applicable.reduce((s, f) => s + FRESHNESS_WEIGHT[f.freshness], 0) / applicable.length;
  const providerQuality = applicable.reduce((s, f) => s + providerQualityOf(f.provider), 0) / applicable.length;

  const reliabilityAvg = reliabilityMultipliers.length > 0 ? reliabilityMultipliers.reduce((s, v) => s + v, 0) / reliabilityMultipliers.length : 1;
  // Maps the multiplier's [0.85, 1.15] possible range onto [0, 1] so it
  // contributes on the same scale as the other components.
  const reliabilityScore = clamp((reliabilityAvg - 0.85) / 0.3, 0, 1);

  const clarity = regimeClarity(regime, regimeInputs);

  const base = completeness * 25 + freshnessScore * 20 + agreement * 20 + providerQuality * 15 + reliabilityScore * 10 + clarity * 10;
  return Math.round(clamp(base, 5, 97));
}
