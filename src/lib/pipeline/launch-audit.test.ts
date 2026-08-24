import { describe, expect, it, vi, beforeEach } from "vitest";
import { MarketScore } from "@/lib/types";

vi.mock("@/db/queries/scores");
vi.mock("@/services/market-data/last-known-good");

import { getCurrentScore } from "@/db/queries/scores";
import {
  getQuoteWithFallback,
  getDailyCandlesWithFallback,
  getIntradayCandlesWithFallback,
  getPositioningWithFallback,
  getFredSeriesWithFallback,
  getRetailSentimentFromStorage,
} from "@/services/market-data/last-known-good";
import { checkContributionSum, findDemoFallbackFactors, runLaunchAudit } from "./launch-audit";

function fixtureScore(overrides: Partial<MarketScore> = {}): MarketScore {
  return {
    symbol: "GBPUSD",
    totalScore: 5,
    bias: "Bullish",
    confidence: 70,
    change24h: 0,
    factors: [
      { key: "technical", contribution: 2, rawScore: 5, weight: 0.4, explanation: "", source: "", provider: "fmp", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() },
      { key: "institutional", contribution: 3, rawScore: 5, weight: 0.6, explanation: "", source: "", provider: "cftc", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() },
    ],
    history: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

describe("checkContributionSum", () => {
  it("valid when factor contributions sum to the total score", () => {
    const { valid, delta } = checkContributionSum(fixtureScore());
    expect(valid).toBe(true);
    expect(delta).toBe(0);
  });

  it("invalid when contributions don't sum to the total (real invariant violation)", () => {
    const { valid, delta } = checkContributionSum(fixtureScore({ totalScore: 9 }));
    expect(valid).toBe(false);
    expect(delta).toBeCloseTo(-4);
  });
});

describe("findDemoFallbackFactors", () => {
  it("returns empty for a fully-real score", () => {
    expect(findDemoFallbackFactors(fixtureScore())).toEqual([]);
  });

  it("flags any factor marked estimated (demo fallback) — should never happen on a LAUNCH_READY market", () => {
    const score = fixtureScore({
      factors: [
        { key: "technical", contribution: 2, rawScore: 5, weight: 0.4, explanation: "", source: "", provider: "demo", freshness: "estimated", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() },
        { key: "institutional", contribution: 3, rawScore: 5, weight: 0.6, explanation: "", source: "", provider: "cftc", freshness: "live", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() },
      ],
    });
    expect(findDemoFallbackFactors(score)).toEqual(["technical"]);
  });
});

function live(hoursAgo: number) {
  const ts = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { provider: "fmp" as const, source: "test", status: "live" as const, fetchedAt: ts, sourceUpdatedAt: ts, nextExpectedUpdate: null, value: {} as never };
}
function notApplicable() {
  return { provider: "cftc" as const, source: "test", status: "not_applicable" as const, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, nextExpectedUpdate: null, value: null };
}

// 22 years of daily candles ending today — enough real span for the
// seasonality field to read "live" (past the 3-year minimum).
function longCandleHistory() {
  const candles = [];
  const days = 22 * 365;
  for (let i = days; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    candles.push({ date, open: 1, high: 1, low: 1, close: 1, volume: 100 });
  }
  const ts = new Date().toISOString();
  return { provider: "fmp" as const, source: "test", status: "live" as const, fetchedAt: ts, sourceUpdatedAt: ts, nextExpectedUpdate: null, value: candles };
}

describe("runLaunchAudit — full PASS/WARNING/FAIL classification against realistic mocked storage state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQuoteWithFallback).mockResolvedValue(live(2));
    vi.mocked(getIntradayCandlesWithFallback).mockResolvedValue(live(1));
    vi.mocked(getPositioningWithFallback).mockResolvedValue(live(48));
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue(live(3));
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue(live(200));
    vi.mocked(getDailyCandlesWithFallback).mockResolvedValue(longCandleHistory());
    vi.mocked(getCurrentScore).mockResolvedValue(fixtureScore());
  });

  it("PASS when every dataset is live/fresh and the score is internally consistent", async () => {
    const rows = await runLaunchAudit();
    for (const row of rows) {
      expect(row.verdict).toBe("PASS");
      expect(row.reasons).toEqual([]);
    }
  });

  it("FAIL when no canonical score is stored at all", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue(null);
    const rows = await runLaunchAudit();
    for (const row of rows) {
      expect(row.verdict).toBe("FAIL");
      expect(row.reasons.some((r) => r.includes("No canonical score"))).toBe(true);
    }
  });

  it("FAIL when the contribution-sum invariant is violated", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue(fixtureScore({ totalScore: 999 }));
    const rows = await runLaunchAudit();
    for (const row of rows) {
      expect(row.verdict).toBe("FAIL");
      expect(row.reasons.some((r) => r.includes("invariant"))).toBe(true);
    }
  });

  it("FAIL when a demo-fallback factor is found on a LAUNCH_READY market", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue(
      fixtureScore({
        factors: [{ key: "technical", contribution: 5, rawScore: 5, weight: 1, explanation: "", source: "", provider: "demo", freshness: "estimated", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() }],
      })
    );
    const rows = await runLaunchAudit();
    for (const row of rows) {
      expect(row.verdict).toBe("FAIL");
      expect(row.reasons.some((r) => r.includes("Demo-fallback"))).toBe(true);
    }
  });

  it("WARNING (never FAIL) when CFTC coverage is structurally not_applicable for this market", async () => {
    vi.mocked(getPositioningWithFallback).mockResolvedValue(notApplicable());
    const rows = await runLaunchAudit();
    for (const row of rows) {
      // not_applicable is never beyondSla, so a market otherwise healthy stays PASS
      expect(row.verdict).toBe("PASS");
      expect(row.cftcReport.status).toBe("not_applicable");
    }
  });

  it("WARNING when a non-fatal dataset (retail sentiment) is stale but everything else is real and fresh", async () => {
    const staleTs = new Date(Date.now() - 200 * 3_600_000).toISOString();
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue({ provider: "oanda", source: "test", status: "stale", fetchedAt: staleTs, sourceUpdatedAt: staleTs, nextExpectedUpdate: null, value: {} as never });
    const rows = await runLaunchAudit();
    for (const row of rows) {
      expect(row.verdict).toBe("WARNING");
      expect(row.reasons.some((r) => r.includes("Retail sentiment"))).toBe(true);
    }
  });
});
