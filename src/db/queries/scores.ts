// Historical score tracking — append-only writes/reads so "what changed
// since N hours ago" is queryable rather than relying on an overwritten
// snapshot. Every call here is a no-op-on-failure by design at the call
// site (see scoring-engine.ts): a database outage must never break score
// computation or serving.
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../client";
import { currentFactorScores, currentMarketScores, factorScores, marketScores } from "../schema";
import { Bias, DataFreshness, MarketScore, ScoreFactor, ScoreFactorKey } from "@/lib/types";

export async function recordScoreHistory(score: MarketScore, scoringVersionId: number | null = null): Promise<void> {
  const db = getDb();
  await db.insert(marketScores).values({
    symbol: score.symbol,
    totalScore: score.totalScore,
    bias: score.bias,
    confidence: score.confidence,
    scoringVersionId,
  });
  await db.insert(factorScores).values(
    score.factors.map((f) => ({
      symbol: score.symbol,
      factorKey: f.key,
      rawScore: f.rawScore,
      weight: f.weight,
      weightedScore: f.contribution,
      explanation: f.explanation,
      // provider is the short code (varchar(32)) — was previously set to
      // f.source (a long human-readable label, up to 45+ chars for some
      // factors), which threw a real Postgres "value too long" error the
      // first time this ever ran against a real, migrated database.
      provider: f.provider ?? "unknown",
      source: f.source,
      status: f.freshness,
      sourceUpdatedAt: f.lastUpdated ? new Date(f.lastUpdated) : null,
      nextExpectedUpdate: f.nextUpdate ? new Date(f.nextUpdate) : null,
      scoringVersionId,
    }))
  );
}

// Before this deployment went READY, computeLiveMarketScore called
// recordScoreHistory unconditionally — including from /markets/[symbol]'s
// static build-time prerenders (it had no dynamic export yet), so every
// test deployment that session wrote its own market_scores/factor_scores
// rows. Neither table has an origin/source column, so a build-time row is
// indistinguishable from a genuine scheduled observation by anything
// stored on the row itself — deleting by inference would risk discarding
// real data. Instead every history read floors its window here: rows
// older than this are never shown as if they were periodic observations.
// Going forward, only /api/cron/scores (persist:true) writes these tables.
export const VALID_SCORE_HISTORY_FROM = new Date("2026-08-20T23:33:51.344Z");

export function flooredSince(sinceHours: number): Date {
  const requested = new Date(Date.now() - sinceHours * 3600_000);
  return requested < VALID_SCORE_HISTORY_FROM ? VALID_SCORE_HISTORY_FROM : requested;
}

export type ScoreHistoryPoint = { computedAt: string; totalScore: number; bias: string; confidence: number };

export async function getScoreHistory(symbol: string, sinceHours = 24 * 30): Promise<ScoreHistoryPoint[]> {
  const db = getDb();
  const since = flooredSince(sinceHours);
  const rows = await db
    .select()
    .from(marketScores)
    .where(and(eq(marketScores.symbol, symbol), gte(marketScores.computedAt, since)))
    .orderBy(desc(marketScores.computedAt));
  return rows.map((r) => ({ computedAt: r.computedAt.toISOString(), totalScore: r.totalScore, bias: r.bias, confidence: r.confidence }));
}

export type FactorChange = { factorKey: string; then: number; now: number; delta: number };

/** Compares the latest factor contributions against the closest prior
 * snapshot at least `sinceHours` old, so the UI can show "why it changed"
 * (e.g. "+0.8 CPI surprise, +0.5 retail sentiment shift ..."). */
export async function getFactorChangesSince(symbol: string, sinceHours: number): Promise<FactorChange[]> {
  const db = getDb();
  const since = flooredSince(sinceHours);

  const latestRows = await db.select().from(factorScores).where(eq(factorScores.symbol, symbol)).orderBy(desc(factorScores.computedAt)).limit(9);

  const priorRows = await db
    .select()
    .from(factorScores)
    .where(and(eq(factorScores.symbol, symbol), gte(factorScores.computedAt, new Date(since.getTime() - 3600_000))))
    .orderBy(factorScores.computedAt)
    .limit(9);

  const latestByKey = new Map(latestRows.map((r) => [r.factorKey, r.weightedScore]));
  const priorByKey = new Map(priorRows.map((r) => [r.factorKey, r.weightedScore]));

  const keys = new Set([...latestByKey.keys(), ...priorByKey.keys()]);
  return Array.from(keys)
    .map((factorKey) => {
      const now = latestByKey.get(factorKey) ?? 0;
      const then = priorByKey.get(factorKey) ?? 0;
      return { factorKey, then, now, delta: Number((now - then).toFixed(2)) };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ---- Current score — the single canonical "current_market_score" record
// (see schema.ts's currentMarketScores/currentFactorScores). Upserted by
// whichever caller just computed a real live score (the scores cron, and
// Market Detail's render as a bootstrap fallback — see scoring-engine.ts),
// and read by BOTH Market Detail and Top Setups so they can never show two
// different numbers for the same market: they're reading the same row.
export async function upsertCurrentScore(score: MarketScore, scoringVersionId: number | null = null): Promise<void> {
  const db = getDb();
  await db
    .insert(currentMarketScores)
    .values({
      symbol: score.symbol,
      totalScore: score.totalScore,
      bias: score.bias,
      confidence: score.confidence,
      change24h: score.change24h,
      scoringVersionId,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: currentMarketScores.symbol,
      set: { totalScore: score.totalScore, bias: score.bias, confidence: score.confidence, change24h: score.change24h, scoringVersionId, computedAt: new Date() },
    });

  await db
    .insert(currentFactorScores)
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
      target: [currentFactorScores.symbol, currentFactorScores.factorKey],
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

// Reconstructs a full MarketScore from the current-score tables, with real
// history from market_scores (the 30-day chart's source) attached — never
// used as a stand-in for "the current score" itself, only as the trailing
// context a MarketScore object needs. Returns null when no current-score
// row exists yet for this symbol (e.g. before the scores cron's first run
// or any Market Detail visit) so callers can fall back to a fresh compute.
export async function getCurrentScore(symbol: string): Promise<MarketScore | null> {
  const db = getDb();
  const [row] = await db.select().from(currentMarketScores).where(eq(currentMarketScores.symbol, symbol)).limit(1);
  if (!row) return null;

  const factorRows = await db.select().from(currentFactorScores).where(eq(currentFactorScores.symbol, symbol));
  if (factorRows.length === 0) return null;

  const priorHistory = await getScoreHistory(symbol, 24 * 30).catch(() => []);
  const history: MarketScore["history"] = [...priorHistory].reverse().map((r) => ({ date: r.computedAt, score: r.totalScore }));

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
    bias: row.bias as Bias,
    confidence: row.confidence,
    change24h: row.change24h,
    factors,
    history,
    lastUpdated: row.computedAt.toISOString(),
  };
}

// Bulk read of every symbol's current-score record in two queries (not one
// per symbol) — for consumers like the Dashboard that need every market's
// canonical score at once. Deliberately skips history (getScoreHistory)
// since none of those consumers render the 30-day chart; callers that need
// history should use getCurrentScore(symbol) for that one symbol instead.
// A symbol with no current-score row yet (or no factor rows for it) is
// simply absent from the returned map — callers must treat that as
// "unavailable", never silently substitute a demo/estimated value.
export async function getAllCurrentScores(): Promise<Map<string, MarketScore>> {
  const db = getDb();
  const [marketRows, factorRows] = await Promise.all([db.select().from(currentMarketScores), db.select().from(currentFactorScores)]);

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

  const result = new Map<string, MarketScore>();
  for (const row of marketRows) {
    const factors = factorsBySymbol.get(row.symbol);
    if (!factors || factors.length === 0) continue;
    result.set(row.symbol, {
      symbol: row.symbol,
      totalScore: row.totalScore,
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
