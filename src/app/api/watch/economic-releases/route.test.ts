import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/economic-calendar/fmp-provider");
vi.mock("@/lib/scoring-v2/release-watch");
vi.mock("@/lib/scoring-v2/engine");
vi.mock("@/db/queries/provider-health");
vi.mock("@/services/data-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/data-mode")>();
  return { ...actual, isDemoOnly: vi.fn(() => false), strictLiveSymbolList: vi.fn(() => ["XAUUSD", "BTCUSD", "USDJPY", "GBPUSD", "EURJPY"]) };
});

import { fmpEconomicCalendarProvider } from "@/services/economic-calendar/fmp-provider";
import { processReleases } from "@/lib/scoring-v2/release-watch";
import { computeMarketScoreV2 } from "@/lib/scoring-v2/engine";
import { recordProviderCheck } from "@/db/queries/provider-health";
import { isDemoOnly, strictLiveSymbolList } from "@/services/data-mode";
import { NextRequest } from "next/server";
import { GET } from "./route";

function req(secret?: string): NextRequest {
  const headers = new Headers();
  if (secret) headers.set("authorization", `Bearer ${secret}`);
  return new NextRequest("https://example.com/api/watch/economic-releases", { headers });
}

describe("GET /api/watch/economic-releases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.EVENT_WATCH_SECRET = "test-watch-secret";
    delete process.env.CRON_SECRET;
    vi.mocked(isDemoOnly).mockReturnValue(false);
    vi.mocked(strictLiveSymbolList).mockReturnValue(["XAUUSD", "BTCUSD", "USDJPY", "GBPUSD", "EURJPY"]);
    vi.mocked(computeMarketScoreV2).mockResolvedValue({ symbol: "x", totalScore: 0, rawScore: 0, bias: "Neutral", confidence: 50, change24h: 0, factors: [], history: [], lastUpdated: "" });
    vi.mocked(recordProviderCheck).mockResolvedValue(undefined);
  });

  it("rejects a request with no bearer token", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(processReleases).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const res = await GET(req("wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("accepts CRON_SECRET as a fallback when EVENT_WATCH_SECRET isn't set", async () => {
    delete process.env.EVENT_WATCH_SECRET;
    process.env.CRON_SECRET = "shared-cron-secret";
    vi.mocked(fmpEconomicCalendarProvider.getReleases).mockResolvedValue({ provider: "fmp", source: "FMP", status: "live", fetchedAt: "", sourceUpdatedAt: "", nextExpectedUpdate: null, value: [] });
    vi.mocked(processReleases).mockResolvedValue({ scanned: 0, processed: [], skippedCount: 0, diagnosticsCount: 0, failCount: 0 });

    const res = await GET(req("shared-cron-secret"));
    expect(res.status).toBe(200);
  });

  it("skips entirely in demo mode without calling the calendar provider", async () => {
    vi.mocked(isDemoOnly).mockReturnValue(true);
    const res = await GET(req("test-watch-secret"));
    const body = await res.json();
    expect(body.skipped).toBe(true);
    expect(fmpEconomicCalendarProvider.getReleases).not.toHaveBeenCalled();
  });

  it("recomputes ONLY the markets a US CPI release actually affects, never every strict-live market", async () => {
    vi.mocked(fmpEconomicCalendarProvider.getReleases).mockResolvedValue({ provider: "fmp", source: "FMP", status: "live", fetchedAt: "", sourceUpdatedAt: "", nextExpectedUpdate: null, value: [] });
    vi.mocked(processReleases).mockResolvedValue({
      scanned: 1,
      processed: [{ releaseKey: "fmp:US:cpi:2027-01-15T13:30:00.000Z", country: "US", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 1 }],
      skippedCount: 0,
      diagnosticsCount: 0,
      failCount: 0,
    });

    const res = await GET(req("test-watch-secret"));
    const body = await res.json();

    const recomputedSymbols = vi.mocked(computeMarketScoreV2).mock.calls.map((c) => c[0]);
    // XAUUSD/BTCUSD are USD-affected via the explicit commodity/crypto push;
    // USDJPY/GBPUSD are USD-quoted pairs — all four legitimately affected.
    expect(recomputedSymbols.sort()).toEqual(["BTCUSD", "GBPUSD", "USDJPY", "XAUUSD"]);
    // EURJPY has no USD relationship at all — the real "never recompute
    // everything" check: it must NOT be recomputed just because something
    // happened this cycle for a different currency entirely.
    expect(recomputedSymbols).not.toContain("EURJPY");
    expect(body.recomputedMarkets.length).toBe(recomputedSymbols.length);
  });

  it("recomputes nothing when no release was newly processed this cycle", async () => {
    vi.mocked(fmpEconomicCalendarProvider.getReleases).mockResolvedValue({ provider: "fmp", source: "FMP", status: "live", fetchedAt: "", sourceUpdatedAt: "", nextExpectedUpdate: null, value: [] });
    vi.mocked(processReleases).mockResolvedValue({ scanned: 3, processed: [], skippedCount: 3, diagnosticsCount: 0, failCount: 0 });

    await GET(req("test-watch-secret"));
    expect(computeMarketScoreV2).not.toHaveBeenCalled();
  });

  it("only recomputes GBP-related markets for a UK release, never a USD/JPY-only pair", async () => {
    vi.mocked(fmpEconomicCalendarProvider.getReleases).mockResolvedValue({ provider: "fmp", source: "FMP", status: "live", fetchedAt: "", sourceUpdatedAt: "", nextExpectedUpdate: null, value: [] });
    vi.mocked(processReleases).mockResolvedValue({
      scanned: 1,
      processed: [{ releaseKey: "fmp:GB:cpi:2027-01-15T09:30:00.000Z", country: "GB", indicatorKey: "cpi", importanceTier: "HIGH", surpriseId: 2 }],
      skippedCount: 0,
      diagnosticsCount: 0,
      failCount: 0,
    });

    await GET(req("test-watch-secret"));
    const recomputedSymbols = vi.mocked(computeMarketScoreV2).mock.calls.map((c) => c[0]);
    expect(recomputedSymbols).toEqual(["GBPUSD"]); // the only GBP-related strict-live symbol in this test's mocked list
  });
});
