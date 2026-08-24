// Regression test for the Dashboard-vs-Top-Setups-vs-Market-Detail score
// mismatch bug: the Dashboard used to render every score-driven stat
// (Markets Tracked, Very Bullish/Bearish, Avg. Confidence, Strongest
// bullish/bearish) via lib/market-data.ts's allMarketRows(), which ALWAYS
// used the demo score generator regardless of DATA_MODE and cached it at
// module scope — so the Dashboard could show e.g. USDCHF +4.5 forever
// while /markets/USDCHF and /top-setups had both moved on to the real,
// current canonical score.
//
// getDashboardMarketRows() must instead read the exact same
// current_market_score records those pages read (getAllCurrentScores), and
// must mark a market ineligible for the bullish/bearish rankings/counts
// whenever it isn't a strict-live symbol — even if it happens to have a
// current-score row — because a non-strict-live symbol's row can
// legitimately be built from hybrid-mode demo-fallback factors, which must
// never leak into those rankings.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MarketScore } from "@/lib/types";

vi.mock("@/db/queries/scores");
vi.mock("@/services/data-mode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/data-mode")>();
  return { ...actual, isDemoOnly: () => false };
});

import { getAllCurrentScores } from "@/db/queries/scores";
import { getDashboardMarketRows } from "./dashboard";

function scoreFor(symbol: string, totalScore: number): MarketScore {
  return {
    symbol,
    totalScore,
    bias: "Neutral",
    confidence: 60,
    change24h: 0,
    factors: [],
    history: [],
    lastUpdated: "2026-08-20T00:00:00.000Z",
  };
}

describe("getDashboardMarketRows — Dashboard reads the same canonical current-score records", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("marks a strict-live symbol with a current-score row eligible, carrying its score through untouched", async () => {
    const canonical = scoreFor("USDCHF", -0.18);
    vi.mocked(getAllCurrentScores).mockResolvedValue(new Map([["USDCHF", canonical]]));

    const rows = await getDashboardMarketRows();
    const usdchf = rows.find((r) => r.instrument.symbol === "USDCHF")!;

    expect(usdchf.eligible).toBe(true);
    expect(usdchf.score).toEqual(canonical);
    expect(usdchf.score!.totalScore).toBe(-0.18);
  });

  it("marks a strict-live symbol with no current-score row yet as ineligible, never a fabricated score", async () => {
    vi.mocked(getAllCurrentScores).mockResolvedValue(new Map());

    const rows = await getDashboardMarketRows();
    const usdchf = rows.find((r) => r.instrument.symbol === "USDCHF")!;

    expect(usdchf.eligible).toBe(false);
    expect(usdchf.score).toBeNull();
  });

  it("marks a blocked (non-strict-live) symbol ineligible even when it does have a current-score row", async () => {
    // NAS100 is one of the explicitly blocked markets (no confirmed
    // provider coverage) — in hybrid mode its current-score row can
    // legitimately be built from demo-fallback factors, so it must never
    // count toward Very Bullish/Bearish, Avg. Confidence, or the
    // bullish/bearish rankings, even though a row exists for it.
    const demoTainted = scoreFor("NAS100", 9.9);
    vi.mocked(getAllCurrentScores).mockResolvedValue(new Map([["NAS100", demoTainted]]));

    const rows = await getDashboardMarketRows();
    const nas100 = rows.find((r) => r.instrument.symbol === "NAS100")!;

    expect(nas100.eligible).toBe(false);
    // Still surfaced as a tracked instrument — just not ranking-eligible.
    expect(rows.some((r) => r.instrument.symbol === "NAS100")).toBe(true);
  });

  it("every one of the 25 tracked instruments is represented exactly once", async () => {
    vi.mocked(getAllCurrentScores).mockResolvedValue(new Map());
    const rows = await getDashboardMarketRows();
    const symbols = rows.map((r) => r.instrument.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(rows.length).toBe(25);
  });
});

// Every currently-promoted STRICT_LIVE symbol — mirrors data-mode.ts and
// top-setups-sync.test.ts. Proves the Dashboard=Top-Setups=Market-Detail
// invariant from the Dashboard's side: same getAllCurrentScores() map in,
// same untouched MarketScore out, for every strict-live market.
const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

describe("Dashboard reads the identical canonical record for every STRICT_LIVE_SYMBOLS market", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(STRICT_LIVE_SYMBOLS)("%s: eligible, and its score matches getAllCurrentScores exactly", async (symbol) => {
    const canonical = scoreFor(symbol, -0.3);
    const map = new Map<string, MarketScore>(STRICT_LIVE_SYMBOLS.map((s) => [s, s === symbol ? canonical : scoreFor(s, 0)]));
    vi.mocked(getAllCurrentScores).mockResolvedValue(map);

    const rows = await getDashboardMarketRows();
    const row = rows.find((r) => r.instrument.symbol === symbol)!;

    expect(row.eligible).toBe(true);
    expect(row.score).toEqual(canonical);
    expect(row.score!.totalScore).toBe(canonical.totalScore);
    expect(row.score!.bias).toBe(canonical.bias);
    expect(row.score!.confidence).toBe(canonical.confidence);
  });
});
