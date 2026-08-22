// Central weighted scoring engine — the ONLY place that assembles factor
// resolutions into a total score. Mirrors the exact pipeline the spec
// requires:
//   raw API data -> normalization -> factor engine -> raw factor score
//   -> factor weight -> weighted contribution -> total market score
//   -> confidence -> bullish/bearish classification
// React components must call computeLiveMarketScore (or the demo
// computeMarketScore in lib/scoring.ts) — never a provider/engine directly.
import { getInstrument } from "@/lib/instruments";
import { classifyBias } from "@/lib/config";
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
import { recordScoreHistory, getScoreHistory, upsertCurrentScore } from "@/db/queries/scores";
import { resolveActiveScoringConfig, ResolvedScoringConfig } from "./scoring-config";

const RESOLVERS: Record<ScoreFactorKey, (symbol: string, mode: DataMode, storageOnly?: boolean) => Promise<ResolvedFactor>> = {
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
  else if (factor.freshness === "unavailable" || factor.freshness === "error" || factor.freshness === "not_applicable") contribution = 0;
  return Number(contribution.toFixed(2));
}

// options.storageOnly (default false): when true, every factor resolver
// reads Neon directly and skips its live-provider call entirely, instead of
// the normal live-first-then-storage-fallback path. This is for callers
// (Top Setups) that must never trigger a live provider fetch just because a
// page rendered — the exact same factor engine, weights, and math run
// either way, only the data-sourcing step changes, so a storage-only call
// and a live-first call reading the same underlying stored state produce
// identical totalScore/bias/confidence/contributions. External providers
// stay the scheduled ingestion cron's job, never the render path's.
export async function computeLiveMarketScore(
  symbol: string,
  mode: DataMode,
  options: { persist?: boolean; storageOnly?: boolean; updateCurrent?: boolean; scoringConfig?: ResolvedScoringConfig; awaitPersist?: boolean } = {}
): Promise<MarketScore> {
  const instrument = getInstrument(symbol);
  if (!instrument) throw new Error(`Unknown instrument ${symbol}`);
  if (mode === "demo") throw new Error("computeLiveMarketScore should only be called for hybrid/live — use computeMarketScore from lib/scoring.ts for demo mode");

  // The admin-configured weights/bias-thresholds (see lib/pipeline/
  // scoring-config.ts) — not the hardcoded DEFAULT_FACTOR_WEIGHTS/
  // DEFAULT_BIAS_THRESHOLDS, which now serve only as the bootstrap
  // fallback for before any configuration has ever been saved. Bulk
  // callers (the admin reweight recompute, the scores cron) resolve this
  // once and pass it in, so all 19 markets share one consistent snapshot
  // instead of racing 19 independent reads.
  const scoringConfig = options.scoringConfig ?? (await resolveActiveScoringConfig());

  const keys = Object.keys(RESOLVERS) as ScoreFactorKey[];
  const resolved = await Promise.all(keys.map((key) => RESOLVERS[key](symbol, mode, options.storageOnly ?? false)));

  const factors: ScoreFactor[] = resolved.map((factor) => {
    const weight = scoringConfig.weights[factor.key];
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
  const bias = classifyBias(totalScore, scoringConfig.biasThresholds);
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
  //
  // options.awaitPersist (default false): fire-and-forget is right for a
  // page render (Market Detail must never block on a write, and a DB
  // outage must never break serving) but wrong for a caller whose entire
  // job IS the write — the Admin reweight/recompute actions await this so
  // "recomputed 19/19" is only reported once every row is actually
  // committed. Without it, a Server Action can return its response (and
  // the underlying serverless invocation can be frozen) before an
  // un-awaited upsert lands, silently dropping the write — this is exactly
  // what let a saved configuration look successful while current_factor_
  // scores kept serving stale weights.
  const historyWrite = options.persist ? recordScoreHistory(score, scoringConfig.id).catch(() => {}) : null;
  const currentWrite = options.persist || options.updateCurrent ? upsertCurrentScore(score, scoringConfig.id).catch(() => {}) : null;
  if (options.awaitPersist) await Promise.all([historyWrite, currentWrite]);

  return score;
}
