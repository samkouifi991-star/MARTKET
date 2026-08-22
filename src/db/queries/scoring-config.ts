// The single source of truth for factor weights and bias thresholds — see
// schema.ts's scoringConfigurations table. Admin's "Save & version" writes
// here; the scoring engine (lib/pipeline/scoring-config.ts) reads the
// active row instead of the hardcoded defaults in lib/config.ts.
import { eq, desc } from "drizzle-orm";
import { getDb } from "../client";
import { scoringConfigurations } from "../schema";
import { BiasThreshold } from "@/lib/config";
import { ScoreFactorKey } from "@/lib/types";

export type ScoringConfigRow = {
  id: number;
  weights: Record<ScoreFactorKey, number>;
  biasThresholds: BiasThreshold[];
  createdBy: string;
  createdAt: Date;
};

// jsonb can't hold -Infinity (JSON.stringify coerces it to null) — the
// "Very Bearish" floor threshold uses -Infinity by convention throughout
// this app (see lib/config.ts's DEFAULT_BIAS_THRESHOLDS and AdminClient.tsx,
// which disables that row's input specifically because it's -Infinity).
// These two helpers are the only place that translates across that
// boundary, so every other consumer keeps working with real -Infinity.
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

// Deactivates every existing row, then inserts the new one as active — two
// sequential statements (not a single transaction), matching this
// project's existing convention for simple sequential writes (see
// recordScoreHistory). A DB outage between the two steps would leave no
// row active, which the engine already handles by falling back to the
// hardcoded bootstrap defaults — never a crash, never silently stale.
export async function createScoringConfiguration(input: {
  weights: Record<ScoreFactorKey, number>;
  biasThresholds: BiasThreshold[];
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
      createdBy: input.createdBy,
    })
    .returning();
  return toRow(row);
}
