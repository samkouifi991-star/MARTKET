// Regression test for the Top-Setups-vs-Market-Detail score mismatch bug:
// Top Setups used to render every market with the demo score generator
// (lib/scoring.ts's computeMarketScore), cached once at module scope for
// the serverless instance's lifetime, while /markets/[symbol] always
// computed a fresh real score via computeLiveMarketScore — so the two
// pages could show completely different numbers for the same market
// forever, until the next deploy happened to reset the cache.
//
// The fix: both pages now read the exact same canonical
// current_market_score row (see db/queries/scores.ts's getCurrentScore) —
// /markets/[symbol] reads it directly (see app/markets/[symbol]/page.tsx),
// and Top Setups reads it via getTopSetupsRows() below. This test proves
// getTopSetupsRows() returns THAT SAME OBJECT, untouched, for every
// STRICT_LIVE_SYMBOLS market whenever a current-score row exists — not a
// separate calculation that can drift — and that it only ever falls back
// to computing its own (storage-only, never live-provider-calling) score
// for a symbol that has no current-score row yet.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MarketScore } from "@/lib/types";

vi.mock("@/db/queries/scores");
vi.mock("./scoring-engine");
// top-setups.ts's isDemoOnly() branch is out of scope here (demo mode never
// calls getCurrentScore/computeLiveMarketScore at all) — pin live mode so
// this test exercises the real-data path being fixed.
vi.mock("@/services/data-mode", () => ({ DATA_MODE: "live", isDemoOnly: () => false }));

import { getCurrentScore } from "@/db/queries/scores";
import { computeLiveMarketScore } from "./scoring-engine";
import { getTopSetupsRows } from "./top-setups";

// Every currently-promoted STRICT_LIVE symbol — mirrors data-mode.ts. Kept
// as a literal list (not imported) so this test independently proves the
// property for the exact set the user actually promoted, rather than
// silently tracking whatever data-mode.ts happens to contain later.
const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

function scoreFor(symbol: string): MarketScore {
  return {
    symbol,
    totalScore: -0.3,
    bias: "Neutral",
    confidence: 58,
    change24h: -4.8,
    factors: [
      { key: "institutional", contribution: 0.4, rawScore: 2.0, weight: 0.2, explanation: "e", source: "CFTC Traders in Financial Futures", provider: "cftc", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-27T00:00:00.000Z" },
      { key: "retailSentiment", contribution: -0.6, rawScore: -3.0, weight: 0.2, explanation: "e", source: "OANDA PositionBook", provider: "oanda", freshness: "delayed", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
      { key: "technical", contribution: -1.1, rawScore: -5.5, weight: 0.2, explanation: "e", source: "Financial Modeling Prep", provider: "fmp", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
      { key: "seasonality", contribution: 0.2, rawScore: 1.0, weight: 0.2, explanation: "e", source: "Historical daily closes (FMP)", provider: "fmp", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-21T00:00:00.000Z" },
      { key: "economicGrowth", contribution: 0.3, rawScore: 1.5, weight: 0.07, explanation: "e", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
      { key: "inflation", contribution: -0.2, rawScore: -1.0, weight: 0.07, explanation: "e", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "stale", lastUpdated: "2026-07-20T00:00:00.000Z", nextUpdate: "2026-08-20T00:00:00.000Z" },
      { key: "labor", contribution: 0.1, rawScore: 0.5, weight: 0.07, explanation: "e", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
      { key: "interestRates", contribution: -0.4, rawScore: -2.0, weight: 0.07, explanation: "e", source: "FRED (Federal Reserve Economic Data)", provider: "fred", freshness: "live", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-09-20T00:00:00.000Z" },
      { key: "news", contribution: 0, rawScore: 0, weight: 0.05, explanation: "e", source: "FMP forex/stock news (keyword classifier v1)", provider: "fmp", freshness: "unavailable", lastUpdated: "2026-08-20T00:00:00.000Z", nextUpdate: "2026-08-20T00:00:00.000Z" },
    ],
    history: [{ date: "2026-08-19T00:00:00.000Z", score: 1.2 }],
    lastUpdated: "2026-08-20T00:00:00.000Z",
  };
}

describe("Top Setups reads the same canonical current-score record as Market Detail", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(STRICT_LIVE_SYMBOLS)("%s: getTopSetupsRows returns getCurrentScore's row untouched, without recomputing", async (symbol) => {
    const canonical = scoreFor(symbol);
    // A distinct canned score per symbol so getCurrentScore is genuinely
    // being read per-instrument, not a single shared fixture object.
    vi.mocked(getCurrentScore).mockImplementation(async (s: string) => (s === symbol ? canonical : { ...canonical, symbol: s, totalScore: 0 }));

    const rows = await getTopSetupsRows();
    const row = rows.find((r) => r.instrument.symbol === symbol)!;

    expect(row.score).toEqual(canonical);
    expect(row.score.totalScore).toBe(canonical.totalScore);
    expect(row.score.bias).toBe(canonical.bias);
    expect(row.score.confidence).toBe(canonical.confidence);
    expect(row.score.change24h).toBe(canonical.change24h);
    for (const f of canonical.factors) {
      const got = row.score.factors.find((x) => x.key === f.key)!;
      expect(got.contribution, `${symbol}/${f.key} contribution`).toBe(f.contribution);
      expect(got.rawScore, `${symbol}/${f.key} rawScore`).toBe(f.rawScore);
    }

    // Never triggers its own compute (and never a live provider fetch)
    // when a canonical current-score row already exists for the symbol —
    // Top Setups must be a pure ranked view of the same records, not a
    // separate calculation that can drift.
    expect(computeLiveMarketScore).not.toHaveBeenCalled();
  });

  it("falls back to a storage-only compute — and persists it as the bootstrap current row — only when no current-score row exists yet", async () => {
    vi.mocked(getCurrentScore).mockResolvedValue(null);
    const fallback = scoreFor("GBPUSD");
    vi.mocked(computeLiveMarketScore).mockResolvedValue(fallback);

    const rows = await getTopSetupsRows();
    const gbpRow = rows.find((r) => r.instrument.symbol === "GBPUSD")!;

    expect(gbpRow.score).toEqual(fallback);
    expect(computeLiveMarketScore).toHaveBeenCalledWith("GBPUSD", expect.anything(), { storageOnly: true, updateCurrent: true });
  });
});
