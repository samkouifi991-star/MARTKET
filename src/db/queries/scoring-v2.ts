// Scoring Engine V2's own current/history score tables — exact structural
// mirrors of db/queries/scores.ts's V1 helpers, but reading/writing the
// completely separate current_market_scores_v2/current_factor_scores_v2/
// market_scores_v2/factor_scores_v2 tables (see schema.ts's V2 section).
// V1's tables and this file's tables never intersect: no query here ever
// touches a v1 table, and vice versa — the shadow-mode isolation is
// structural, not a runtime filter that could be forgotten.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../client";
import { currentFactorScoresV2, currentMarketScoresV2, factorScoresV2, marketScoresV2, scoringIntegrityErrors, scoringShadowComparisons } from "../schema";
import { Bias, DataFreshness, ScoreFactor, ScoreFactorKey } from "@/lib/types";

// V2's MarketScore adds rawScore (pre-smoothing) alongside the same fields
// V1's MarketScore carries — requirement #16's "keep raw score available in
// Admin/debugging".
export type MarketScoreV2 = {
  symbol: string;
  totalScore: number;
  rawScore: number;
  bias: Bias;
  confidence: number;
  change24h: number;
  factors: ScoreFactor[];
  history: { date: string; score: number }[];
  lastUpdated: string;
};

export async function upsertCurrentScoreV2(score: MarketScoreV2, scoringVersionId: number | null): Promise<void> {
  const db = getDb();
  await db
    .insert(currentMarketScoresV2)
    .values({
      symbol: score.symbol,
      totalScore: score.totalScore,
      rawScore: score.rawScore,
      bias: score.bias,
      confidence: score.confidence,
      change24h: score.change24h,
      scoringVersionId,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: currentMarketScoresV2.symbol,
      set: { totalScore: score.totalScore, rawScore: score.rawScore, bias: score.bias, confidence: score.confidence, change24h: score.change24h, scoringVersionId, computedAt: new Date() },
    });

  await db
    .insert(currentFactorScoresV2)
    .values(
      score.factors.map((f) => ({
        symbol: score.symbol,
        factorKey: f.key,
        rawScore: f.rawScore,
        weight: f.weight,
        weightedScore: f.contribution,
        explanation: f.explanation,
        provider: f.provider ?? "unknown",
        source: f.source,
        status: f.freshness,
        sourceUpdatedAt: f.lastUpdated ? new Date(f.lastUpdated) : null,
        nextExpectedUpdate: f.nextUpdate ? new Date(f.nextUpdate) : null,
        scoringVersionId,
        computedAt: new Date(),
      }))
    )
    .onConflictDoUpdate({
      target: [currentFactorScoresV2.symbol, currentFactorScoresV2.factorKey],
      set: {
        rawScore: sql`excluded.raw_score`,
        weight: sql`excluded.weight`,
        weightedScore: sql`excluded.weighted_score`,
        explanation: sql`excluded.explanation`,
        provider: sql`excluded.provider`,
        source: sql`excluded.source`,
        status: sql`excluded.status`,
        sourceUpdatedAt: sql`excluded.source_updated_at`,
        nextExpectedUpdate: sql`excluded.next_expected_update`,
        scoringVersionId: sql`excluded.scoring_version_id`,
        computedAt: sql`excluded.computed_at`,
      },
    });
}

/** Requirement #10's materiality gate lives in the caller (engine.ts) — this
 * writes unconditionally whenever called, matching V1's recordScoreHistory. */
export async function recordScoreHistoryV2(score: MarketScoreV2, scoringVersionId: number | null): Promise<void> {
  const db = getDb();
  await db.insert(marketScoresV2).values({ symbol: score.symbol, totalScore: score.totalScore, bias: score.bias, confidence: score.confidence, scoringVersionId });
  await db.insert(factorScoresV2).values(
    score.factors.map((f) => ({
      symbol: score.symbol,
      factorKey: f.key,
      rawScore: f.rawScore,
      weight: f.weight,
      weightedScore: f.contribution,
      explanation: f.explanation,
      provider: f.provider ?? "unknown",
      source: f.source,
      status: f.freshness,
      sourceUpdatedAt: f.lastUpdated ? new Date(f.lastUpdated) : null,
      nextExpectedUpdate: f.nextUpdate ? new Date(f.nextUpdate) : null,
      scoringVersionId,
    }))
  );
}

export type ScoreHistoryPointV2 = { computedAt: string; totalScore: number; bias: string; confidence: number };

export async function getScoreHistoryV2(symbol: string, sinceHours = 24 * 150): Promise<ScoreHistoryPointV2[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await db
    .select()
    .from(marketScoresV2)
    .where(and(eq(marketScoresV2.symbol, symbol), gte(marketScoresV2.computedAt, since)))
    .orderBy(desc(marketScoresV2.computedAt));
  return rows.map((r) => ({ computedAt: r.computedAt.toISOString(), totalScore: r.totalScore, bias: r.bias, confidence: r.confidence }));
}

export async function getCurrentScoreV2(symbol: string): Promise<MarketScoreV2 | null> {
  const db = getDb();
  const [row] = await db.select().from(currentMarketScoresV2).where(eq(currentMarketScoresV2.symbol, symbol)).limit(1);
  if (!row) return null;

  const factorRows = await db.select().from(currentFactorScoresV2).where(eq(currentFactorScoresV2.symbol, symbol));
  if (factorRows.length === 0) return null;

  const priorHistory = await getScoreHistoryV2(symbol).catch(() => []);
  const history = [...priorHistory].reverse().map((r) => ({ date: r.computedAt, score: r.totalScore }));

  const factors: ScoreFactor[] = factorRows.map((f) => ({
    key: f.factorKey as ScoreFactorKey,
    contribution: f.weightedScore,
    rawScore: f.rawScore,
    weight: f.weight,
    explanation: f.explanation,
    source: f.source,
    provider: f.provider,
    freshness: f.status as DataFreshness,
    lastUpdated: (f.sourceUpdatedAt ?? f.computedAt).toISOString(),
    nextUpdate: (f.nextExpectedUpdate ?? f.computedAt).toISOString(),
  }));

  return {
    symbol: row.symbol,
    totalScore: row.totalScore,
    rawScore: row.rawScore,
    bias: row.bias as Bias,
    confidence: row.confidence,
    change24h: row.change24h,
    factors,
    history,
    lastUpdated: row.computedAt.toISOString(),
  };
}

/** Bulk read for the Admin V1-vs-V2 comparison page — mirrors
 * db/queries/scores.ts's getAllCurrentScores (two queries, not N). */
export async function getAllCurrentScoresV2(): Promise<Map<string, MarketScoreV2>> {
  const db = getDb();
  const [marketRows, factorRows] = await Promise.all([db.select().from(currentMarketScoresV2), db.select().from(currentFactorScoresV2)]);

  const factorsBySymbol = new Map<string, ScoreFactor[]>();
  for (const f of factorRows) {
    const factor: ScoreFactor = {
      key: f.factorKey as ScoreFactorKey,
      contribution: f.weightedScore,
      rawScore: f.rawScore,
      weight: f.weight,
      explanation: f.explanation,
      source: f.source,
      provider: f.provider,
      freshness: f.status as DataFreshness,
      lastUpdated: (f.sourceUpdatedAt ?? f.computedAt).toISOString(),
      nextUpdate: (f.nextExpectedUpdate ?? f.computedAt).toISOString(),
    };
    const list = factorsBySymbol.get(f.symbol);
    if (list) list.push(factor);
    else factorsBySymbol.set(f.symbol, [factor]);
  }

  const result = new Map<string, MarketScoreV2>();
  for (const row of marketRows) {
    const factors = factorsBySymbol.get(row.symbol);
    if (!factors || factors.length === 0) continue;
    result.set(row.symbol, {
      symbol: row.symbol,
      totalScore: row.totalScore,
      rawScore: row.rawScore,
      bias: row.bias as Bias,
      confidence: row.confidence,
      change24h: row.change24h,
      factors,
      history: [],
      lastUpdated: row.computedAt.toISOString(),
    });
  }
  return result;
}

/** The two (or `limit`) most recent DISTINCT computation cycles' full
 * factor sets for a symbol — attribution.ts (M6) diffs the newest against
 * the one before it to build "why did the score change". Grouped by exact
 * computedAt value since one cycle writes one row per factor sharing a
 * single timestamp (see recordScoreHistoryV2 above). */
export async function getRecentFactorScoreV2Snapshots(symbol: string, limit = 2): Promise<{ computedAt: string; factors: ScoreFactor[] }[]> {
  const db = getDb();
  // Generous row limit: a full factor set is at most ~10 rows (9 ScoreFactorKeys
  // + a possible "event" pseudo-factor), so limit*15 comfortably covers `limit`
  // distinct cycles even if a cycle wrote slightly more rows than usual.
  const rows = await db.select().from(factorScoresV2).where(eq(factorScoresV2.symbol, symbol)).orderBy(desc(factorScoresV2.computedAt)).limit(limit * 15);

  const byTimestamp = new Map<string, ScoreFactor[]>();
  for (const r of rows) {
    const key = r.computedAt.toISOString();
    const factor: ScoreFactor = {
      key: r.factorKey as ScoreFactorKey,
      contribution: r.weightedScore,
      rawScore: r.rawScore,
      weight: r.weight,
      explanation: r.explanation,
      source: r.source,
      provider: r.provider,
      freshness: r.status as DataFreshness,
      lastUpdated: (r.sourceUpdatedAt ?? r.computedAt).toISOString(),
      nextUpdate: (r.nextExpectedUpdate ?? r.computedAt).toISOString(),
    };
    const list = byTimestamp.get(key);
    if (list) list.push(factor);
    else byTimestamp.set(key, [factor]);
  }

  return Array.from(byTimestamp.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([computedAt, factors]) => ({ computedAt, factors }));
}

export type ShadowComparisonInput = {
  symbol: string;
  v1Score: number;
  v1Bias: string;
  v1Confidence: number;
  v2Score: number;
  v2Bias: string;
  v2Confidence: number;
  triggerReleaseId?: number | null;
};

export async function recordShadowComparison(input: ShadowComparisonInput): Promise<void> {
  const db = getDb();
  await db.insert(scoringShadowComparisons).values({
    symbol: input.symbol,
    v1Score: input.v1Score,
    v1Bias: input.v1Bias,
    v1Confidence: input.v1Confidence,
    v2Score: input.v2Score,
    v2Bias: input.v2Bias,
    v2Confidence: input.v2Confidence,
    triggerReleaseId: input.triggerReleaseId ?? null,
  });
}

export type ShadowComparisonRow = ShadowComparisonInput & { computedAt: string };

export async function getShadowComparisons(symbol: string, sinceHours = 24 * 150): Promise<ShadowComparisonRow[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rows = await db
    .select()
    .from(scoringShadowComparisons)
    .where(and(eq(scoringShadowComparisons.symbol, symbol), gte(scoringShadowComparisons.computedAt, since)))
    .orderBy(desc(scoringShadowComparisons.computedAt));
  return rows.map((r) => ({
    symbol: r.symbol,
    v1Score: r.v1Score,
    v1Bias: r.v1Bias,
    v1Confidence: r.v1Confidence,
    v2Score: r.v2Score,
    v2Bias: r.v2Bias,
    v2Confidence: r.v2Confidence,
    triggerReleaseId: r.triggerReleaseId,
    computedAt: r.computedAt.toISOString(),
  }));
}

/** The latest shadow comparison per symbol — one query, not one per symbol —
 * for the Admin comparison page's "V1 vs V2 right now" table. */
export async function getLatestShadowComparisons(): Promise<Map<string, ShadowComparisonRow>> {
  const db = getDb();
  const rows = await db.select().from(scoringShadowComparisons).orderBy(desc(scoringShadowComparisons.computedAt));
  const result = new Map<string, ShadowComparisonRow>();
  for (const r of rows) {
    if (result.has(r.symbol)) continue; // rows are already ordered desc — first hit per symbol is the latest
    result.set(r.symbol, {
      symbol: r.symbol,
      v1Score: r.v1Score,
      v1Bias: r.v1Bias,
      v1Confidence: r.v1Confidence,
      v2Score: r.v2Score,
      v2Bias: r.v2Bias,
      v2Confidence: r.v2Confidence,
      triggerReleaseId: r.triggerReleaseId,
      computedAt: r.computedAt.toISOString(),
    });
  }
  return result;
}

export async function recordIntegrityError(input: { symbol: string; errors: string[]; scoringVersionId: number | null }): Promise<void> {
  const db = getDb();
  await db.insert(scoringIntegrityErrors).values({ symbol: input.symbol, errors: input.errors, scoringVersionId: input.scoringVersionId });
}

export type IntegrityErrorRow = { symbol: string; errors: string[]; scoringVersionId: number | null; computedAt: string };

/** Recent integrity failures across every symbol, for Admin visibility —
 * requirement #19's "record the error in Admin". */
export async function getRecentIntegrityErrors(limit = 50): Promise<IntegrityErrorRow[]> {
  const db = getDb();
  const rows = await db.select().from(scoringIntegrityErrors).orderBy(desc(scoringIntegrityErrors.computedAt)).limit(limit);
  return rows.map((r) => ({ symbol: r.symbol, errors: r.errors as string[], scoringVersionId: r.scoringVersionId, computedAt: r.computedAt.toISOString() }));
}
