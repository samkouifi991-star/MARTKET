// Centralized price-consistency regression test — the exact bug this
// exists to fix: ETHUSD showed 3,589.87 on Top Setups (lib/demo/price.ts's
// deterministic-but-fake generator, which top-setups.ts fell back to for
// price outside demo mode) while Market Detail separately live-fetched and
// showed the real 2,424.77 for the same symbol, at the same time.
//
// Architecture being verified: Provider -> scheduled ingestion cron ->
// canonical Neon row (market_prices) -> every UI surface reads that same
// row via price.ts's getCanonicalPriceCard. Top Setups/Markets/Heatmap/
// Watchlists/the landing page read it through top-setups.ts's
// getCanonicalMarketRows(); Market Detail reads it through
// market-detail.ts's getLiveMarketDetail(). Both call the identical
// underlying function, so this test proves — for every one of the 19
// STRICT_LIVE_SYMBOLS, not just ETHUSD — that both entry points return
// exactly the same current price and 24h change for a given symbol, and
// that neither ever falls back to the demo generator's value while real
// data is mocked as available.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MarketScore } from "@/lib/types";
import { NormalizedCandle, NormalizedQuote, Provenance, unavailable } from "@/services/types";
import { getInstrument } from "@/lib/instruments";
import { generatePriceData } from "@/lib/demo/price";

vi.mock("@/db/queries/scores");
vi.mock("./scoring-engine");
vi.mock("@/services/market-data/last-known-good");
vi.mock("./positioning");
vi.mock("@/services/data-mode", () => ({ DATA_MODE: "live", isDemoOnly: () => false, allowsDemoFallback: () => false }));

import { getCurrentScore } from "@/db/queries/scores";
import {
  getQuoteWithFallback,
  getDailyCandlesWithFallback,
  getIntradayCandlesWithFallback,
  getPositioningWithFallback,
  getRetailSentimentFromStorage,
} from "@/services/market-data/last-known-good";
import { resolveSmartMoney } from "./positioning";
import { getCanonicalMarketRows } from "./top-setups";
import { getLiveMarketDetail } from "./market-detail";

const STRICT_LIVE_SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

// A distinct canonical price per symbol — ETHUSD pinned to the exact real
// value from the regression report (2,424.77) so this test independently
// proves the fix for the literal reported case, not just a structural
// property with arbitrary numbers.
const PRICE_BY_SYMBOL: Record<string, number> = Object.fromEntries(STRICT_LIVE_SYMBOLS.map((s, i) => [s, 1000 + i * 37.5]));
PRICE_BY_SYMBOL.ETHUSD = 2424.77;

function canonicalQuote(symbol: string): Provenance<NormalizedQuote> {
  const price = PRICE_BY_SYMBOL[symbol];
  const now = new Date().toISOString();
  return {
    provider: "oanda",
    source: "OANDA v20",
    status: "live",
    fetchedAt: now,
    sourceUpdatedAt: now,
    nextExpectedUpdate: null,
    value: { symbol, price, changePct24h: 1.25, timestamp: now },
  };
}

// 30 synthetic daily candles — enough for computeTechnicalTrend's ~25-bar
// minimum so getCanonicalPriceCard takes its "real data" branch rather than
// falling through to unavailable/demo. The exact closes don't matter for
// this test (only quote.value.price feeds PriceData.current), just that
// there's enough history for a valid technical result.
function canonicalDailyCandles(): Provenance<NormalizedCandle[]> {
  const candles: NormalizedCandle[] = Array.from({ length: 30 }, (_, i) => {
    const close = 100 + i;
    return { date: new Date(Date.now() - (30 - i) * 86_400_000).toISOString(), open: close - 1, high: close + 1, low: close - 2, close, volume: 1000 };
  });
  return {
    provider: "fmp",
    source: "Financial Modeling Prep",
    status: "live",
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: candles[candles.length - 1].date,
    nextExpectedUpdate: null,
    value: candles,
  };
}

function genericScore(symbol: string): MarketScore {
  return {
    symbol,
    totalScore: 0,
    bias: "Neutral",
    confidence: 50,
    change24h: 0,
    factors: [],
    history: [],
    lastUpdated: new Date().toISOString(),
  };
}

describe("Every current-price surface reads the same canonical price", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getCurrentScore).mockImplementation(async (s: string) => genericScore(s));
    vi.mocked(getQuoteWithFallback).mockImplementation(async (s: string) => canonicalQuote(s));
    vi.mocked(getDailyCandlesWithFallback).mockResolvedValue(canonicalDailyCandles());
    vi.mocked(getIntradayCandlesWithFallback).mockResolvedValue(unavailable("fmp", "Financial Modeling Prep"));
    vi.mocked(getPositioningWithFallback).mockResolvedValue(unavailable("cftc", "CFTC Commitments of Traders"));
    vi.mocked(getRetailSentimentFromStorage).mockResolvedValue(unavailable("oanda", "Retail Sentiment"));
    vi.mocked(resolveSmartMoney).mockResolvedValue({ signal: "None", confidence: 0, explanation: "", provider: "cftc", freshness: "unavailable" });
  });

  it("ETHUSD: Top Setups (and Markets/Heatmap/Watchlists/landing) shows the same real price as Market Detail — never the demo generator's value", async () => {
    const rows = await getCanonicalMarketRows();
    const topSetupsPrice = rows.find((r) => r.instrument.symbol === "ETHUSD")!.price.current;

    const detail = await getLiveMarketDetail("ETHUSD", "live");
    const marketDetailPrice = detail.price.data!.current;

    expect(topSetupsPrice).toBe(2424.77);
    expect(marketDetailPrice).toBe(2424.77);
    expect(topSetupsPrice).toBe(marketDetailPrice);

    // The literal regression: 3,589.87 must never appear anywhere once a
    // real canonical price (2,424.77) is available.
    const demoPrice = generatePriceData(getInstrument("ETHUSD")!).current;
    expect(topSetupsPrice).not.toBe(demoPrice);
  });

  it.each(STRICT_LIVE_SYMBOLS)("%s: Top Setups price === Market Detail price === canonical price", async (symbol) => {
    const rows = await getCanonicalMarketRows();
    const rowPrice = rows.find((r) => r.instrument.symbol === symbol)!.price.current;

    const detail = await getLiveMarketDetail(symbol, "live");
    const detailPrice = detail.price.data!.current;

    expect(rowPrice).toBe(PRICE_BY_SYMBOL[symbol]);
    expect(detailPrice).toBe(PRICE_BY_SYMBOL[symbol]);
    expect(rowPrice).toBe(detailPrice);
  });

  it("never calls a live provider from either entry point — both are storage-only reads", async () => {
    await getCanonicalMarketRows();
    await getLiveMarketDetail("ETHUSD", "live");

    // storageOnly is always the second/third argument on every price-path
    // call — verifying this (rather than just the return value) proves no
    // code path can silently start calling providers live again in the
    // future. Filtered to the technical-trend's 260-day daily-candle
    // request specifically, since seasonalityCard also calls
    // getDailyCandlesWithFallback (with its own, much larger window) and is
    // intentionally out of scope for this price-only fix — it keeps its
    // existing live-first behavior.
    for (const call of vi.mocked(getQuoteWithFallback).mock.calls) {
      expect(call[1]).toBe(true);
    }
    for (const call of vi.mocked(getDailyCandlesWithFallback).mock.calls.filter((c) => c[1] === 260)) {
      expect(call[2]).toBe(true);
    }
  });
});
