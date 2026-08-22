// Round-trip test for the canonical "current score" record (see
// schema.ts's currentMarketScores/currentFactorScores): whatever
// upsertCurrentScore writes, getCurrentScore must read back unchanged —
// this is the single row both Market Detail and Top Setups read, so any
// silent field drop/rename here would reintroduce the exact
// Top-Setups-vs-Market-Detail mismatch bug this table was built to fix.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { currentMarketScores, currentFactorScores } from "../schema";
import { MarketScore } from "@/lib/types";

let currentMarketRows: Record<string, unknown>[] = [];
let currentFactorRows: Record<string, unknown>[] = [];

function isSqlFragment(v: unknown): boolean {
  // upsertCurrentScore's batched factor upsert uses sql`excluded.column`
  // markers (real Postgres ON CONFLICT semantics for a multi-row insert —
  // see upsertCandles in db/queries/market-data.ts for the same pattern) —
  // this fake resolves each marker to that row's own field, mirroring what
  // Postgres's `excluded` pseudo-table actually does per conflicting row.
  return typeof v === "object" && v !== null && !(v instanceof Date);
}

type FakeQuery<T> = Promise<T[]> & {
  where: () => FakeQuery<T>;
  limit: (n: number) => FakeQuery<T>;
  orderBy: () => FakeQuery<T>;
};

function makeQuery<T>(rows: T[]): FakeQuery<T> {
  const promise = Promise.resolve(rows) as FakeQuery<T>;
  promise.where = () => makeQuery(rows);
  promise.limit = (n: number) => makeQuery(rows.slice(0, n));
  promise.orderBy = () => makeQuery(rows);
  return promise;
}

vi.mock("../client", () => ({
  getDb: () => ({
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        const rows = (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
        return {
          onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
            const isMarket = table === currentMarketScores;
            const store = isMarket ? currentMarketRows : currentFactorRows;
            const keyOf = (r: Record<string, unknown>) => (isMarket ? String(r.symbol) : `${r.symbol}:${r.factorKey}`);
            for (const row of rows) {
              const resolved: Record<string, unknown> = { ...row };
              for (const [k, sv] of Object.entries(set)) {
                resolved[k] = isSqlFragment(sv) ? row[k] : sv;
              }
              const idx = store.findIndex((r) => keyOf(r) === keyOf(row));
              if (idx >= 0) store[idx] = { ...store[idx], ...resolved };
              else store.push(resolved);
            }
            return Promise.resolve();
          },
        };
      },
    }),
    select: () => ({
      from: (table: unknown) => makeQuery(table === currentMarketScores ? currentMarketRows : table === currentFactorScores ? currentFactorRows : []),
    }),
  }),
}));

import { upsertCurrentScore, getCurrentScore } from "./scores";

const SAMPLE_SCORE: MarketScore = {
  symbol: "USDCHF",
  totalScore: -0.3,
  bias: "Neutral",
  confidence: 58,
  change24h: -4.8,
  factors: [
    { key: "institutional", contribution: 0.4, rawScore: 2.0, weight: 0.2, explanation: "Institutional longs building", source: "CFTC Traders in Financial Futures", provider: "cftc", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-27T00:00:00.000Z" },
    { key: "retailSentiment", contribution: -0.6, rawScore: -3.0, weight: 0.2, explanation: "Retail crowded long", source: "OANDA PositionBook", provider: "oanda", freshness: "delayed", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
    { key: "technical", contribution: -1.1, rawScore: -5.5, weight: 0.2, explanation: "Below 200 SMA", source: "Financial Modeling Prep", provider: "fmp", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
    { key: "seasonality", contribution: 0.2, rawScore: 1.0, weight: 0.2, explanation: "Slight seasonal tailwind", source: "Historical daily closes (FMP)", provider: "fmp", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
    { key: "economicGrowth", contribution: 0.3, rawScore: 1.5, weight: 0.07, explanation: "GDP differential favors USD", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
    { key: "inflation", contribution: -0.2, rawScore: -1.0, weight: 0.07, explanation: "CPI differential narrows", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "stale", lastUpdated: "2026-07-20T00:00:00.000Z", nextUpdate: "2026-08-20T00:00:00.000Z" },
    { key: "labor", contribution: 0.1, rawScore: 0.5, weight: 0.07, explanation: "Labor market steady", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
    { key: "interestRates", contribution: -0.4, rawScore: -2.0, weight: 0.07, explanation: "SNB more dovish than Fed", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
    { key: "news", contribution: 0, rawScore: 0, weight: 0.05, explanation: "No high-impact related news", source: "FMP forex/stock news (keyword classifier v1)", provider: "fmp", freshness: "unavailable", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-20T00:00:00.000Z" },
  ],
  history: [],
  lastUpdated: "2026-08-20T00:00:00.000Z",
};

describe("current_market_scores / current_factor_scores round trip", () => {
  beforeEach(() => {
    currentMarketRows = [];
    currentFactorRows = [];
  });

  it("reads back every top-level field exactly as written", async () => {
    await upsertCurrentScore(SAMPLE_SCORE);
    const read = await getCurrentScore("USDCHF");

    expect(read).not.toBeNull();
    expect(read!.symbol).toBe(SAMPLE_SCORE.symbol);
    expect(read!.totalScore).toBe(SAMPLE_SCORE.totalScore);
    expect(read!.bias).toBe(SAMPLE_SCORE.bias);
    expect(read!.confidence).toBe(SAMPLE_SCORE.confidence);
    expect(read!.change24h).toBe(SAMPLE_SCORE.change24h);
  });

  it("reads back every factor's contribution, rawScore, freshness, and source exactly as written", async () => {
    await upsertCurrentScore(SAMPLE_SCORE);
    const read = await getCurrentScore("USDCHF");

    for (const written of SAMPLE_SCORE.factors) {
      const got = read!.factors.find((f) => f.key === written.key)!;
      expect(got, `factor ${written.key} present`).toBeDefined();
      expect(got.contribution, `${written.key} contribution`).toBe(written.contribution);
      expect(got.rawScore, `${written.key} rawScore`).toBe(written.rawScore);
      expect(got.weight, `${written.key} weight`).toBe(written.weight);
      expect(got.explanation, `${written.key} explanation`).toBe(written.explanation);
      expect(got.source, `${written.key} source`).toBe(written.source);
      expect(got.provider, `${written.key} provider`).toBe(written.provider);
      expect(got.freshness, `${written.key} freshness`).toBe(written.freshness);
    }
  });

  it("a second write for the same symbol overwrites in place rather than accumulating rows", async () => {
    await upsertCurrentScore(SAMPLE_SCORE);
    const updated: MarketScore = { ...SAMPLE_SCORE, totalScore: 4.5, bias: "Bullish" };
    await upsertCurrentScore(updated);

    expect(currentMarketRows.length).toBe(1);
    expect(currentFactorRows.filter((r) => r.symbol === "USDCHF").length).toBe(SAMPLE_SCORE.factors.length);

    const read = await getCurrentScore("USDCHF");
    expect(read!.totalScore).toBe(4.5);
    expect(read!.bias).toBe("Bullish");
  });

  it("returns null for a symbol with no current-score row yet", async () => {
    const read = await getCurrentScore("NOROWYET");
    expect(read).toBeNull();
  });
});
