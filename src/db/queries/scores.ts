// Historical score tracking — append-only writes/reads so "what changed
// since N hours ago" is queryable rather than relying on an overwritten
// snapshot. Every call here is a no-op-on-failure by design at the call
// site (see scoring-engine.ts): a database outage must never break score
// computation or serving.
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../client";
import { factorScores, marketScores } from "../schema";
import { MarketScore } from "@/lib/types";

export async function recordScoreHistory(score: MarketScore): Promise<void> {
  const db = getDb();
  await db.insert(marketScores).values({
    symbol: score.symbol,
    totalScore: score.totalScore,
    bias: score.bias,
    confidence: score.confidence,
  });
  await db.insert(factorScores).values(
    score.factors.map((f) => ({
      symbol: score.symbol,
      factorKey: f.key,
      rawScore: f.rawScore,
      weight: f.weight,
      weightedScore: f.contribution,
      explanation: f.explanation,
      provider: f.source,
      source: f.source,
      status: f.freshness,
      sourceUpdatedAt: f.lastUpdated ? new Date(f.lastUpdated) : null,
      nextExpectedUpdate: f.nextUpdate ? new Date(f.nextUpdate) : null,
    }))
  );
}

export type ScoreHistoryPoint = { computedAt: string; totalScore: number; bias: string; confidence: number };

export async function getScoreHistory(symbol: string, sinceHours = 24 * 30): Promise<ScoreHistoryPoint[]> {
  const db = getDb();
  const since = new Date(Date.now() - sinceHours * 3600_000);
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
  const since = new Date(Date.now() - sinceHours * 3600_000);

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
