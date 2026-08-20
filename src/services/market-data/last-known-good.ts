// Last-known-good fallback for quote/daily-candle reads on the *display and
// scoring* path (not cron ingestion, which must stay pure-live — it's the
// thing that populates the storage this file reads back). Architecture:
//   FMP ingestion -> Neon -> factor calculations -> stored scores -> UI
// The page should primarily reflect real stored data; a failed live refresh
// must degrade the freshness badge, not blank the page. Built specifically
// to fix an outage where FMP 429s made a page with real 228-row Neon
// history for GBPUSD render as fully unavailable.
//
// Rule (verbatim from the spec that motivated this): if the latest live
// call didn't return "live", fall back to whatever was last actually
// stored — recent stored data reads DELAYED, older reads STALE, and only
// "there has never been a stored value at all" reads UNAVAILABLE. A stored
// value is never erased or hidden just because the newest refresh failed.
import * as fmp from "./fmp";
import { getLatestStoredPrice, getLatestStoredDailyCandles } from "@/db/queries/market-data";
import { NormalizedCandle, NormalizedQuote, Provenance } from "../types";

// Matches the real cron cadence (daily, once/day — see vercel.json and
// gbpusd-validation.ts's own CRON_SCHEDULE comment on why this project's
// refresh cycle is once-daily on the Hobby plan) plus buffer: data younger
// than this is "recently refreshed, just not on this exact request" —
// DELAYED, not STALE.
const RECENT_STORAGE_WINDOW_MS = 36 * 3_600_000;

function classifyStoredAge(fetchedAt: Date): "delayed" | "stale" {
  return Date.now() - fetchedAt.getTime() <= RECENT_STORAGE_WINDOW_MS ? "delayed" : "stale";
}

export async function getQuoteWithFallback(symbol: string): Promise<Provenance<NormalizedQuote>> {
  const live = await fmp.getQuote(symbol);
  if (live.status === "live") return live;

  const stored = await getLatestStoredPrice(symbol);
  if (!stored) return live; // never had data -> surface the live unavailable/error/rate-limited result unchanged

  const freshness = classifyStoredAge(stored.fetchedAt);
  const sourceTimestamp = (stored.sourceUpdatedAt ?? stored.fetchedAt).toISOString();
  return {
    provider: "fmp",
    source: "Financial Modeling Prep (last known good — stored)",
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(), // the real time we stored this, not now()
    sourceUpdatedAt: sourceTimestamp,
    nextExpectedUpdate: null,
    value: { symbol, price: stored.price, changePct24h: stored.changePct24h, timestamp: sourceTimestamp },
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing last stored value from ${stored.fetchedAt.toISOString()}`,
  };
}

export async function getDailyCandlesWithFallback(symbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  const live = await fmp.getDailyCandles(symbol, days);
  if (live.status === "live") return live;

  const stored = await getLatestStoredDailyCandles(symbol);
  if (!stored || stored.candles.length === 0) return live;

  const freshness = classifyStoredAge(stored.fetchedAt);
  return {
    provider: "fmp",
    source: "Financial Modeling Prep (last known good — stored)",
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: stored.candles[stored.candles.length - 1].date,
    nextExpectedUpdate: null,
    value: stored.candles,
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}`,
  };
}
