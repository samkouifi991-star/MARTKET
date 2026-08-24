import { describe, expect, it, vi, beforeEach } from "vitest";
import { unavailable } from "@/services/types";

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
import { buildPipelineHealthReport } from "./pipeline-health";

function live(hoursAgo: number) {
  const ts = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { provider: "fmp" as const, source: "test", status: "live" as const, fetchedAt: ts, sourceUpdatedAt: ts, nextExpectedUpdate: null, value: {} as never };
}
function stale(hoursAgo: number) {
  const ts = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return { provider: "fmp" as const, source: "test", status: "stale" as const, fetchedAt: ts, sourceUpdatedAt: ts, nextExpectedUpdate: null, value: {} as never };
}
function notApplicable() {
  return unavailable("cftc", "test");
}

describe("buildPipelineHealthReport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getQuoteWithFallback).mockResolvedValue(live(2));
    vi.mocked(getDailyCandlesWithFallback).mockResolvedValue(live(20));
    vi.mocked(getIntradayCandlesWithFallback).mockResolvedValue(live(1));
    vi.mocked(getPositioningWithFallback).mockResolvedValue(live(48));
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue(live(3));
    vi.mocked(getFredSeriesWithFallback).mockResolvedValue(live(200));
    vi.mocked(getCurrentScore).mockResolvedValue({ symbol: "GBPUSD", totalScore: 1, bias: "Neutral", confidence: 60, change24h: 0, factors: [], history: [], lastUpdated: new Date().toISOString() });
  });

  it("returns one row per LAUNCH_READY market with the real per-dataset status/age", async () => {
    const rows = await buildPipelineHealthReport();
    expect(rows.length).toBeGreaterThan(0);
    const gbpusd = rows.find((r) => r.symbol === "GBPUSD")!;
    expect(gbpusd.price.status).toBe("live");
    expect(gbpusd.price.beyondSla).toBe(false);
    expect(gbpusd.price.ageHours).toBeCloseTo(2, 1);
  });

  it("flags a stale dataset as beyond SLA, using the dataset's own already-established freshness status — no new threshold invented here", async () => {
    vi.mocked(getPositioningWithFallback).mockResolvedValue(stale(400));
    const rows = await buildPipelineHealthReport();
    const gbpusd = rows.find((r) => r.symbol === "GBPUSD")!;
    expect(gbpusd.cftcReport.status).toBe("stale");
    expect(gbpusd.cftcReport.beyondSla).toBe(true);
  });

  it("never flags not_applicable as beyond SLA — a structurally-inapplicable dataset (e.g. no CFTC contract) isn't a pipeline problem", async () => {
    vi.mocked(getPositioningWithFallback).mockResolvedValue(notApplicable() as never);
    const rows = await buildPipelineHealthReport();
    const gbpusd = rows.find((r) => r.symbol === "GBPUSD")!;
    expect(gbpusd.cftcReport.status).toBe("unavailable");
  });

  it("flags score computation as beyond SLA once it exceeds the once-daily-cron SLA window, and never fabricates an age when no current-score row exists", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue(null);
    const rows = await buildPipelineHealthReport();
    const row = rows[0];
    expect(row.scoreComputation.status).toBe("unavailable");
    expect(row.scoreComputation.ageHours).toBeNull();
    expect(row.scoreComputation.beyondSla).toBe(true);
  });

  it("flags a stale score computation as beyond SLA", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue({
      symbol: "GBPUSD",
      totalScore: 1,
      bias: "Neutral",
      confidence: 60,
      change24h: 0,
      factors: [],
      history: [],
      lastUpdated: new Date(Date.now() - 48 * 3_600_000).toISOString(),
    });
    const rows = await buildPipelineHealthReport();
    const gbpusd = rows.find((r) => r.symbol === "GBPUSD")!;
    expect(gbpusd.scoreComputation.beyondSla).toBe(true);
  });
});
