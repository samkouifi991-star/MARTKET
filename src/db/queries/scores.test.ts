import { describe, expect, it, vi, beforeEach } from "vitest";

// The real bug this locks in: recordScoreHistory wrote the long,
// human-readable `source` label (e.g. "Price & indicator engine (FMP daily
// candles)", 45 chars) into factor_scores.provider, a varchar(32) column —
// only ever exercised once the database actually had a real schema and
// real long-source factors to insert, which is exactly what surfaced it.
const insertedValues: unknown[] = [];

vi.mock("../client", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: unknown) => {
        insertedValues.push(v);
        return Promise.resolve();
      },
    }),
  }),
}));

import { recordScoreHistory } from "./scores";
import { MarketScore } from "@/lib/types";

describe("recordScoreHistory", () => {
  beforeEach(() => insertedValues.length = 0);

  it("writes the short provider code, not the long source label, into factor_scores.provider", async () => {
    const score: MarketScore = {
      symbol: "GBPUSD",
      totalScore: 1.15,
      bias: "Neutral",
      confidence: 64,
      change24h: 0,
      factors: [
        {
          key: "technical",
          contribution: 1.47,
          rawScore: 7.37,
          weight: 0.2,
          explanation: "Price is above all 4 available moving averages",
          source: "Price & indicator engine (FMP daily candles)", // 46 chars — exceeds varchar(32)
          provider: "fmp",
          freshness: "delayed",
          lastUpdated: new Date().toISOString(),
          nextUpdate: new Date().toISOString(),
        },
      ],
      history: [],
      lastUpdated: new Date().toISOString(),
    };

    await recordScoreHistory(score);

    // Second insert().values() call is the factor_scores one (first is marketScores).
    const factorScoresValues = insertedValues[1] as { provider: string; source: string }[];
    expect(factorScoresValues[0].provider).toBe("fmp");
    expect(factorScoresValues[0].provider.length).toBeLessThanOrEqual(32);
    expect(factorScoresValues[0].source).toBe("Price & indicator engine (FMP daily candles)"); // source itself stays the full label
  });

  it("falls back to a safe short value when a factor has no provider set (e.g. the demo generator)", async () => {
    const score: MarketScore = {
      symbol: "GBPUSD",
      totalScore: 0,
      bias: "Neutral",
      confidence: 50,
      change24h: 0,
      factors: [
        {
          key: "news",
          contribution: 0,
          rawScore: 0,
          weight: 0.07,
          explanation: "demo",
          source: "News Intelligence engine",
          freshness: "estimated",
          lastUpdated: new Date().toISOString(),
          nextUpdate: new Date().toISOString(),
        },
      ],
      history: [],
      lastUpdated: new Date().toISOString(),
    };

    await recordScoreHistory(score);

    const factorScoresValues = insertedValues[1] as { provider: string }[];
    expect(factorScoresValues[0].provider).toBe("unknown");
  });
});
