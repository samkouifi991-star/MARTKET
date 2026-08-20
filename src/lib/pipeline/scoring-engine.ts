// Central weighted scoring engine — the ONLY place that assembles factor
// resolutions into a total score. Mirrors the exact pipeline the spec
// requires:
//   raw API data -> normalization -> factor engine -> raw factor score
//   -> factor weight -> weighted contribution -> total market score
//   -> confidence -> bullish/bearish classification
// React components must call computeLiveMarketScore (or the demo
// computeMarketScore in lib/scoring.ts) — never a provider/engine directly.
import { getInstrument } from "@/lib/instruments";
import { DEFAULT_FACTOR_WEIGHTS, classifyBias } from "@/lib/config";
import { MarketScore, ScoreFactor, ScoreFactorKey } from "@/lib/types";
import { DataMode } from "@/services/data-mode";
import { ResolvedFactor } from "./types";
import { resolveTechnicalFactor } from "./technical";
import { resolveSeasonalityFactor } from "./seasonality";
import { resolveInstitutionalFactor } from "./positioning";
import { resolveRetailSentimentFactor } from "./sentiment";
import { resolveEconomicGrowthFactor, resolveInflationFactor, resolveLaborFactor, resolveInterestRatesFactor } from "./macro";
import { resolveNewsFactor } from "./news";
import { computeConfidence } from "./confidence";
import { recordScoreHistory } from "@/db/queries/scores";

const RESOLVERS: Record<ScoreFactorKey, (symbol: string, mode: DataMode) => Promise<ResolvedFactor>> = {
  institutional: resolveInstitutionalFactor,
  retailSentiment: resolveRetailSentimentFactor,
  technical: resolveTechnicalFactor,
  seasonality: resolveSeasonalityFactor,
  economicGrowth: resolveEconomicGrowthFactor,
  inflation: resolveInflationFactor,
  labor: resolveLaborFactor,
  interestRates: resolveInterestRatesFactor,
  news: resolveNewsFactor,
};

function contributionFor(factor: ResolvedFactor, weight: number): number {
  let contribution = factor.rawScore * weight;
  if (factor.freshness === "stale") contribution *= 0.5;
  else if (factor.freshness === "estimated") contribution *= 0.7;
  else if (factor.freshness === "unavailable" || factor.freshness === "error") contribution = 0;
  return Number(contribution.toFixed(2));
}

export async function computeLiveMarketScore(symbol: string, mode: DataMode): Promise<MarketScore> {
  const instrument = getInstrument(symbol);
  if (!instrument) throw new Error(`Unknown instrument ${symbol}`);
  if (mode === "demo") throw new Error("computeLiveMarketScore should only be called for hybrid/live — use computeMarketScore from lib/scoring.ts for demo mode");

  const keys = Object.keys(RESOLVERS) as ScoreFactorKey[];
  const resolved = await Promise.all(keys.map((key) => RESOLVERS[key](symbol, mode)));

  const factors: ScoreFactor[] = resolved.map((factor) => {
    const weight = DEFAULT_FACTOR_WEIGHTS[factor.key];
    return {
      key: factor.key,
      contribution: contributionFor(factor, weight),
      rawScore: Number(factor.rawScore.toFixed(2)),
      weight,
      explanation: factor.explanation,
      source: factor.source,
      provider: factor.provider,
      freshness: factor.freshness,
      lastUpdated: factor.lastUpdated,
      nextUpdate: factor.nextUpdate,
    };
  });

  const totalScore = Number(factors.reduce((s, f) => s + f.contribution, 0).toFixed(2));
  const bias = classifyBias(totalScore);
  const confidence = computeConfidence(resolved);
  const now = new Date().toISOString();

  const score: MarketScore = {
    symbol,
    totalScore,
    bias,
    confidence,
    change24h: 0, // populated from DB history once enough rows exist — see db/queries/scores.ts
    factors,
    history: [{ date: now, score: totalScore }],
    lastUpdated: now,
  };

  // Best-effort persistence: never let a DB outage break score computation
  // or serving. In live/hybrid mode with no DB configured yet, this is
  // expected to fail silently until DATABASE_URL is set.
  recordScoreHistory(score).catch(() => {});

  return score;
}
