import { describe, expect, it, vi, beforeEach } from "vitest";
import { getTableName, Table } from "drizzle-orm";
import { ScoreFactor } from "@/lib/types";

const insertedValues: { table: string; values: unknown }[] = [];
let selectResults: Record<string, unknown[]> = {};

// Mirrors db/queries/scores.test.ts's insert-capture approach (this
// project's established pattern for testing query-layer write shape
// without a full relational fake) plus a table-keyed select stub for the
// read-side functions, which mostly do real post-processing (grouping/
// sorting/dedup) on whatever rows come back — that logic is what's worth
// testing here, not drizzle's own filtering. getTableName is drizzle's own
// public API for resolving a schema table object's real SQL name, so this
// mock always routes to the right fake table even if internals change.
vi.mock("../client", () => ({
  getDb: () => ({
    insert: (table: Table) => ({
      values: (v: unknown) => {
        insertedValues.push({ table: getTableName(table), values: v });
        return {
          onConflictDoUpdate: () => Promise.resolve(),
          returning: () => Promise.resolve([v]),
        };
      },
    }),
    select: () => ({
      from: (table: Table) => makeQuery(selectResults[getTableName(table)] ?? []),
    }),
  }),
}));

function tableNameOf(table: Table): string {
  return getTableName(table);
}

type FakeQuery<T> = Promise<T[]> & { where: () => FakeQuery<T>; orderBy: () => FakeQuery<T>; limit: (n: number) => FakeQuery<T> };
function makeQuery<T>(data: T[]): FakeQuery<T> {
  const promise = Promise.resolve(data) as FakeQuery<T>;
  promise.where = () => makeQuery(data);
  promise.orderBy = () => makeQuery(data);
  promise.limit = (n: number) => makeQuery(data.slice(0, n));
  return promise;
}

import {
  upsertCurrentScoreV2,
  getRecentFactorScoreV2Snapshots,
  getFactorScoreV2History,
  getScoreV2AsOf,
  recordShadowComparison,
  getLatestShadowComparisons,
  recordIntegrityError,
  getRecentIntegrityErrors,
  MarketScoreV2,
} from "./scoring-v2";
import { currentMarketScoresV2, currentFactorScoresV2, factorScoresV2, scoringShadowComparisons, scoringIntegrityErrors } from "../schema";

function factor(overrides: Partial<ScoreFactor> = {}): ScoreFactor {
  return {
    key: "technical",
    contribution: 1,
    rawScore: 5,
    weight: 0.2,
    explanation: "test",
    source: "Test source",
    provider: "test",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
    ...overrides,
  };
}

describe("upsertCurrentScoreV2", () => {
  beforeEach(() => {
    insertedValues.length = 0;
  });

  it("writes both the total-score row (with rawScore preserved for Admin/debugging) and one row per factor", async () => {
    const score: MarketScoreV2 = {
      symbol: "XAUUSD",
      totalScore: 4.2,
      rawScore: 5.1,
      bias: "Bullish",
      confidence: 70,
      change24h: 1.1,
      factors: [factor({ key: "technical", contribution: 1.2 }), factor({ key: "inflation", contribution: 0.8 })],
      history: [],
      lastUpdated: new Date().toISOString(),
    };
    await upsertCurrentScoreV2(score, 3);

    const marketWrite = insertedValues.find((w) => w.table === "current_market_scores_v2");
    expect(marketWrite).toBeDefined();
    expect(marketWrite?.values).toMatchObject({ symbol: "XAUUSD", totalScore: 4.2, rawScore: 5.1, scoringVersionId: 3 });

    const factorWrite = insertedValues.find((w) => w.table === "current_factor_scores_v2");
    expect(factorWrite).toBeDefined();
    expect((factorWrite?.values as unknown[]).length).toBe(2);
  });
});

describe("getRecentFactorScoreV2Snapshots", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("groups factor rows by their shared computedAt and returns the most recent N cycles, newest first", async () => {
    const cycle1 = new Date("2027-01-01T00:00:00.000Z");
    const cycle2 = new Date("2027-01-02T00:00:00.000Z");
    selectResults["factor_scores_v2"] = [
      { symbol: "XAUUSD", factorKey: "technical", rawScore: 1, weight: 0.2, weightedScore: 0.2, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: cycle2 },
      { symbol: "XAUUSD", factorKey: "inflation", rawScore: 2, weight: 0.1, weightedScore: 0.2, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: cycle2 },
      { symbol: "XAUUSD", factorKey: "technical", rawScore: 0.5, weight: 0.2, weightedScore: 0.1, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: cycle1 },
    ];

    const snapshots = await getRecentFactorScoreV2Snapshots("XAUUSD", 2);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].computedAt).toBe(cycle2.toISOString());
    expect(snapshots[0].factors).toHaveLength(2);
    expect(snapshots[1].computedAt).toBe(cycle1.toISOString());
    expect(snapshots[1].factors).toHaveLength(1);
  });

  it("returns an empty array when no factor history exists yet for this symbol", async () => {
    selectResults["factor_scores_v2"] = [];
    const snapshots = await getRecentFactorScoreV2Snapshots("XAUUSD");
    expect(snapshots).toEqual([]);
  });
});

describe("getFactorScoreV2History", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("groups every row into one entry per calendar day, using that day's LAST cycle per factor key", async () => {
    const morningCycle = new Date("2027-01-01T09:00:00.000Z");
    const eveningCycle = new Date("2027-01-01T18:00:00.000Z"); // same day, later cycle — should win
    const nextDay = new Date("2027-01-02T09:00:00.000Z");
    selectResults["factor_scores_v2"] = [
      { symbol: "XAUUSD", factorKey: "inflation", rawScore: 1, weight: 0.1, weightedScore: 0.5, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: morningCycle },
      { symbol: "XAUUSD", factorKey: "inflation", rawScore: 2, weight: 0.1, weightedScore: 1.2, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: eveningCycle },
      { symbol: "XAUUSD", factorKey: "technical", rawScore: 3, weight: 0.2, weightedScore: 0.3, explanation: "e", provider: "p", source: "s", status: "live", sourceUpdatedAt: null, nextExpectedUpdate: null, computedAt: nextDay },
    ];

    const history = await getFactorScoreV2History("XAUUSD");
    expect(history).toHaveLength(2);
    expect(history[0].date).toBe("2027-01-01");
    expect(history[0].factors).toEqual([{ key: "inflation", contribution: 1.2 }]); // evening cycle's value, not morning's
    expect(history[1].date).toBe("2027-01-02");
    expect(history[1].factors).toEqual([{ key: "technical", contribution: 0.3 }]);
  });

  it("returns an empty array when no history exists yet for this symbol", async () => {
    selectResults["factor_scores_v2"] = [];
    expect(await getFactorScoreV2History("XAUUSD")).toEqual([]);
  });
});

describe("getScoreV2AsOf", () => {
  beforeEach(() => {
    selectResults = {};
  });

  it("returns the real stored score/bias/confidence for a prior observation", async () => {
    selectResults["market_scores_v2"] = [{ symbol: "XAUUSD", totalScore: 2.3, bias: "Neutral", confidence: 55, computedAt: new Date("2027-01-01T00:00:00.000Z") }];
    const snapshot = await getScoreV2AsOf("XAUUSD", "2027-01-02T00:00:00.000Z");
    expect(snapshot).toEqual({ totalScore: 2.3, bias: "Neutral", confidence: 55, computedAt: "2027-01-01T00:00:00.000Z" });
  });

  it("returns null when no observation exists that far back yet — never a fabricated baseline", async () => {
    selectResults["market_scores_v2"] = [];
    expect(await getScoreV2AsOf("XAUUSD", "2027-01-02T00:00:00.000Z")).toBeNull();
  });
});

describe("shadow comparisons", () => {
  beforeEach(() => {
    insertedValues.length = 0;
    selectResults = {};
  });

  it("records a V1-vs-V2 comparison row", async () => {
    await recordShadowComparison({ symbol: "XAUUSD", v1Score: 2.1, v1Bias: "Neutral", v1Confidence: 60, v2Score: 5.4, v2Bias: "Bullish", v2Confidence: 75, triggerReleaseId: 9 });
    const write = insertedValues.find((w) => w.table === "scoring_shadow_comparisons");
    expect(write?.values).toMatchObject({ symbol: "XAUUSD", v1Score: 2.1, v2Score: 5.4, triggerReleaseId: 9 });
  });

  it("returns only the latest comparison per symbol, not every historical row", async () => {
    const older = new Date("2027-01-01T00:00:00.000Z");
    const newer = new Date("2027-01-02T00:00:00.000Z");
    selectResults["scoring_shadow_comparisons"] = [
      { symbol: "XAUUSD", v1Score: 5, v1Bias: "Bullish", v1Confidence: 80, v2Score: 6, v2Bias: "Bullish", v2Confidence: 85, triggerReleaseId: null, computedAt: newer },
      { symbol: "XAUUSD", v1Score: 1, v1Bias: "Neutral", v1Confidence: 50, v2Score: 2, v2Bias: "Neutral", v2Confidence: 55, triggerReleaseId: null, computedAt: older },
    ];
    const latest = await getLatestShadowComparisons();
    expect(latest.get("XAUUSD")?.v2Score).toBe(6);
    expect(latest.size).toBe(1);
  });
});

describe("integrity errors", () => {
  beforeEach(() => {
    insertedValues.length = 0;
    selectResults = {};
  });

  it("records an integrity failure for Admin visibility", async () => {
    await recordIntegrityError({ symbol: "XAUUSD", errors: ["totalScore is NaN"], scoringVersionId: 2 });
    const write = insertedValues.find((w) => w.table === "scoring_integrity_errors");
    expect(write?.values).toMatchObject({ symbol: "XAUUSD", errors: ["totalScore is NaN"], scoringVersionId: 2 });
  });

  it("reads back recent integrity errors", async () => {
    selectResults["scoring_integrity_errors"] = [{ symbol: "XAUUSD", errors: ["x"], scoringVersionId: 1, computedAt: new Date() }];
    const rows = await getRecentIntegrityErrors();
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual(["x"]);
  });
});

// Sanity: the schema table objects really do carry the drizzle table-name
// symbol this mock relies on to route inserts/selects to the right fake
// table — if drizzle ever changed this internal, these tests would fail
// loudly instead of silently reading/writing the wrong table.
describe("mock plumbing sanity", () => {
  it("resolves real table names from the schema objects", () => {
    expect(tableNameOf(currentMarketScoresV2)).toBe("current_market_scores_v2");
    expect(tableNameOf(currentFactorScoresV2)).toBe("current_factor_scores_v2");
    expect(tableNameOf(factorScoresV2)).toBe("factor_scores_v2");
    expect(tableNameOf(scoringShadowComparisons)).toBe("scoring_shadow_comparisons");
    expect(tableNameOf(scoringIntegrityErrors)).toBe("scoring_integrity_errors");
  });
});
