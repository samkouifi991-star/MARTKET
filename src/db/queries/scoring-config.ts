// The single source of truth for factor weights and bias thresholds — see
// schema.ts's scoringConfigurations table. Admin's "Save & version" writes
// here; the scoring engine (lib/pipeline/scoring-config.ts) reads the
// active row instead of the hardcoded defaults in lib/config.ts.
import { eq, desc } from "drizzle-orm";
import { getDb } from "../client";
import { scoringConfigurations } from "../schema";
import { BiasThreshold } from "@/lib/config";
import { ScoreFactorKey } from "@/lib/types";
import { ScoringV2Settings } from "@/lib/scoring-v2/config";

export type ScoringConfigRow = {
  id: number;
  weights: Record<ScoreFactorKey, number>;
  biasThresholds: BiasThreshold[];
  // Scoring V2's full behavior-tuning config, versioned in this same row
  // (requirement #24's "one Save & Version" for the complete model) — null
  // on every row saved before V2 existed; engine.ts falls back to
  // DEFAULT_SCORING_V2_SETTINGS exactly like v1 already does for weights.
  v2Settings: ScoringV2Settings | null;
  createdBy: string;
  createdAt: Date;
};

// jsonb can't hold -Infinity (JSON.stringify coerces it to null). Very
// Bearish's threshold used to be stored as -Infinity by convention before
// it became a real editable number (see lib/config.ts); deserializeThresholds
// still translates the marker back for configurations saved under that old
// convention, but every save from here on writes a plain finite number.
const NEG_INFINITY_MARKER = "-Infinity";

function serializeThresholds(thresholds: BiasThreshold[]): { bias: string; min: number | string }[] {
  return thresholds.map((t) => ({ bias: t.bias, min: t.min === -Infinity ? NEG_INFINITY_MARKER : t.min }));
}

function deserializeThresholds(raw: { bias: string; min: number | string }[]): BiasThreshold[] {
  return raw.map((t) => ({ bias: t.bias as BiasThreshold["bias"], min: t.min === NEG_INFINITY_MARKER ? -Infinity : Number(t.min) }));
}

function toRow(r: typeof scoringConfigurations.$inferSelect): ScoringConfigRow {
  return {
    id: r.id,
    weights: r.weights as Record<ScoreFactorKey, number>,
    biasThresholds: deserializeThresholds(r.biasThresholds as { bias: string; min: number | string }[]),
    v2Settings: (r.v2Settings as ScoringV2Settings | null) ?? null,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

export async function getActiveScoringConfiguration(): Promise<ScoringConfigRow | null> {
  const db = getDb();
  const [row] = await db.select().from(scoringConfigurations).where(eq(scoringConfigurations.active, true)).orderBy(desc(scoringConfigurations.createdAt)).limit(1);
  return row ? toRow(row) : null;
}

export async function getScoringConfigurationById(id: number): Promise<ScoringConfigRow | null> {
  const db = getDb();
  const [row] = await db.select().from(scoringConfigurations).where(eq(scoringConfigurations.id, id)).limit(1);
  return row ? toRow(row) : null;
}

export type ScoringConfigVersionSummary = { id: number; createdBy: string; createdAt: Date; includesV2Settings: boolean };

// Phase 18 (public-launch demo sweep): Admin's "Audit log" card was seeded
// with hand-picked demo entries shown unconditionally, regardless of
// DATA_MODE — every real "Save & Version" already writes a new row here
// (never edits in place, see createScoringConfiguration below), so that
// history IS the real audit trail; it just wasn't being read back.
export async function listScoringConfigurationVersions(limit: number): Promise<ScoringConfigVersionSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ id: scoringConfigurations.id, createdBy: scoringConfigurations.createdBy, createdAt: scoringConfigurations.createdAt, v2Settings: scoringConfigurations.v2Settings })
    .from(scoringConfigurations)
    .orderBy(desc(scoringConfigurations.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, createdBy: r.createdBy, createdAt: r.createdAt, includesV2Settings: r.v2Settings !== null }));
}

// Deactivates every existing row, then inserts the new one as active — two
// sequential statements (not a single transaction), matching this
// project's existing convention for simple sequential writes (see
// recordScoreHistory). A DB outage between the two steps would leave no
// row active, which the engine already handles by falling back to the
// hardcoded bootstrap defaults — never a crash, never silently stale.
export async function createScoringConfiguration(input: {
  weights: Record<ScoreFactorKey, number>;
  biasThresholds: BiasThreshold[];
  v2Settings?: ScoringV2Settings | null;
  createdBy: string;
}): Promise<ScoringConfigRow> {
  const db = getDb();
  await db.update(scoringConfigurations).set({ active: false }).where(eq(scoringConfigurations.active, true));
  const [row] = await db
    .insert(scoringConfigurations)
    .values({
      active: true,
      weights: input.weights,
      biasThresholds: serializeThresholds(input.biasThresholds),
      v2Settings: input.v2Settings ?? null,
      createdBy: input.createdBy,
    })
    .returning();
  return toRow(row);
}
