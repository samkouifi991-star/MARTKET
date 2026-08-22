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

import { recordScoreHistory, flooredSince, VALID_SCORE_HISTORY_FROM, SCORE_HISTORY_WINDOW_HOURS } from "./scores";
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

describe("SCORE_HISTORY_WINDOW_HOURS — platform-wide ~5 month chart window", () => {
  it("matches lib/time.ts's RECENT_CHART_WINDOW_DAYS (150 days) so every chart consumer of getScoreHistory's default shares one window", () => {
    expect(SCORE_HISTORY_WINDOW_HOURS).toBe(24 * 150);
  });
});

describe("flooredSince — pre-persistence-gating history cutoff", () => {
  // The real problem this locks in: before the deployment that shipped
  // persist:true gating, computeLiveMarketScore wrote a market_scores row
  // on every static build-time prerender of /markets/[symbol]. Neither
  // market_scores nor factor_scores has a column identifying a row's
  // origin, so a stray build-time row can't be told apart from a genuine
  // cron observation by anything stored on it — deleting by inference would
  // risk discarding real data. The safe fix is a floor: never treat
  // anything before the gating deployment's timestamp as real history.
  it("floors a request window that would reach before the cutoff", () => {
    const since = flooredSince(24 * 365); // "1 year back" reaches well before the cutoff
    expect(since.getTime()).toBe(VALID_SCORE_HISTORY_FROM.getTime());
  });

  it("leaves a request window that stays after the cutoff untouched", () => {
    // Pin "now" comfortably after the (fixed, real) cutoff so this test
    // doesn't depend on how much real wall-clock time has passed since the
    // cutoff deployment — which could itself be very recent.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(VALID_SCORE_HISTORY_FROM.getTime() + 60 * 24 * 3_600_000)); // 60 days later
    try {
      const sinceHours = 1;
      const since = flooredSince(sinceHours);
      expect(since.getTime()).toBe(Date.now() - sinceHours * 3_600_000);
      expect(since.getTime()).toBeGreaterThan(VALID_SCORE_HISTORY_FROM.getTime());
    } finally {
      vi.useRealTimers();
    }
  });
});
