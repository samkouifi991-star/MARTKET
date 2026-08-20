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
import { recordScoreHistory, getScoreHistory } from "@/db/queries/scores";

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

export function contributionFor(factor: ResolvedFactor, weight: number): number {
  let contribution = factor.rawScore * weight;
  // "delayed" now legitimately includes last-known-good data read from
  // storage after a live refresh failed (see last-known-good.ts) — real,
  // recent data, just not freshly re-fetched this instant. It was
  // previously undampened (fell through to full weight), inconsistent with
  // confidence.ts's own freshness weighting (live 1.0, delayed 0.75, stale
  // 0.3) — a mild dampening here keeps intelligence available while still
  // reflecting the gap, per "confidence should decrease based on age/
  // freshness, but the intelligence should remain available."
  if (factor.freshness === "delayed") contribution *= 0.85;
  else if (factor.freshness === "stale") contribution *= 0.5;
  else if (factor.freshness === "estimated") contribution *= 0.7;
  else if (factor.freshness === "unavailable" || factor.freshness === "error") contribution = 0;
  return Number(contribution.toFixed(2));
}

export async function computeLiveMarketScore(symbol: string, mode: DataMode, options: { persist?: boolean } = {}): Promise<MarketScore> {
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

  // Real history from Neon (market_scores), not a hardcoded single point —
  // this was the actual bug behind "the chart shows one point despite many
  // stored rows": history was never queried at all, always just
  // `[{date: now, score: totalScore}]`. Read before this run's own write
  // (which happens below, fire-and-forget) so there's no race with it —
  // the just-computed point is appended directly rather than re-read back.
  // Best-effort: a DB outage must never break score computation or serving.
  const priorHistory = await getScoreHistory(symbol, 24 * 30).catch(() => []);
  const history: MarketScore["history"] = [...priorHistory].reverse().map((r) => ({ date: r.computedAt, score: r.totalScore }));
  history.push({ date: now, score: totalScore });

  // 24h change from the real stored history: the closest prior point at
  // least ~24h old, not just the previous render.
  const dayAgo = Date.now() - 24 * 3_600_000;
  const priorPoint = [...history].reverse().find((p) => new Date(p.date).getTime() <= dayAgo);
  const change24h = Number((totalScore - (priorPoint?.score ?? totalScore)).toFixed(2));

  const score: MarketScore = {
    symbol,
    totalScore,
    bias,
    confidence,
    change24h,
    factors,
    history,
    lastUpdated: now,
  };

  // Persistence is opt-in (options.persist), not automatic on every call.
  // computeLiveMarketScore also runs on every dynamic page render for the
  // market detail page — if it recorded a row unconditionally, the score
  // history chart would fill up with one point per page view/build instead
  // of genuine independent market observations (this was confirmed as the
  // real cause behind "many market_scores rows that aren't really distinct
  // observations": the page used to be statically prerendered once per
  // deploy, so every test deployment this session wrote its own row).
  // Only the periodic scores cron (src/app/api/cron/scores/route.ts) passes
  // persist:true — it's the sole source of truth for score history.
  // Best-effort either way: never let a DB outage break score computation
  // or serving.
  if (options.persist) recordScoreHistory(score).catch(() => {});

  return score;
}
