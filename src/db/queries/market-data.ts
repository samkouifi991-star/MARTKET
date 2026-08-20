// Write-side queries for the raw-storage stage of the pipeline (External API
// -> raw storage -> normalization -> ...). Every ingestion cron job writes
// through these instead of touching Drizzle tables directly, so the upsert/
// dedupe rules live in one place.
//
// Read-side "latest stored" queries live here too (not just writes) — they
// back the last-known-good fallback (see services/market-data/
// last-known-good.ts): when a live provider call fails, the display/scoring
// pipeline needs to read back exactly what was last actually stored, not
// just append to it.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import { marketPrices, marketCandles, institutionalPositioning, retailSentiment, economicIndicators, economicEvents, newsArticles } from "../schema";
import { NormalizedCandle, NormalizedEconomicEvent, NormalizedNewsArticle, NormalizedQuote } from "@/services/types";
import { CftcPositioningResult } from "@/services/market-data/cftc";
import { FredIndicatorKey } from "@/services/market-data/fred-series";

export async function upsertMarketPrice(symbol: string, quote: NormalizedQuote, provider: string): Promise<void> {
  const db = getDb();
  await db
    .insert(marketPrices)
    .values({ symbol, price: quote.price, changePct24h: quote.changePct24h, provider, status: "live", sourceUpdatedAt: new Date(quote.timestamp) })
    .onConflictDoUpdate({
      target: marketPrices.symbol,
      set: { price: quote.price, changePct24h: quote.changePct24h, provider, status: "live", sourceUpdatedAt: new Date(quote.timestamp), fetchedAt: new Date() },
    });
}

export async function upsertCandles(symbol: string, timeframe: "1h" | "4h" | "1d", candles: NormalizedCandle[], provider: string): Promise<void> {
  if (candles.length === 0) return;
  const db = getDb();
  // Chunk to keep a single insert statement reasonable in size.
  const chunkSize = 500;
  for (let i = 0; i < candles.length; i += chunkSize) {
    const chunk = candles.slice(i, i + chunkSize);
    await db
      .insert(marketCandles)
      .values(chunk.map((c) => ({ symbol, timeframe, date: new Date(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, provider })))
      .onConflictDoUpdate({
        target: [marketCandles.symbol, marketCandles.timeframe, marketCandles.date],
        set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume`, fetchedAt: new Date() },
      });
  }
}

export async function upsertPositioning(symbol: string, pos: CftcPositioningResult, source: string): Promise<void> {
  const db = getDb();
  await db
    .insert(institutionalPositioning)
    .values({
      symbol,
      classification: pos.classification,
      reportDate: new Date(pos.reportDate),
      longContracts: pos.longContracts,
      shortContracts: pos.shortContracts,
      netPositioning: pos.netPositioning,
      openInterest: pos.openInterest,
      pctLong: pos.pctLong,
      pctShort: pos.pctShort,
      netWeeklyChange: pos.netWeeklyChange,
      percentile1y: pos.percentile1y,
      percentile3y: pos.percentile3y,
      direction: pos.direction,
      strength: pos.strength,
      source,
    })
    .onConflictDoNothing({ target: [institutionalPositioning.symbol, institutionalPositioning.classification, institutionalPositioning.reportDate] });
}

export async function insertRetailSentiment(symbol: string, pctLong: number, pctShort: number, status: string, provider?: string, source?: string): Promise<void> {
  const db = getDb();
  await db.insert(retailSentiment).values({ symbol, pctLong, pctShort, status, ...(provider ? { provider } : {}), ...(source ? { source } : {}) });
}

export async function upsertEconomicIndicator(country: string, indicator: FredIndicatorKey, seriesId: string, date: string, value: number): Promise<void> {
  const db = getDb();
  await db
    .insert(economicIndicators)
    .values({ country, indicator, seriesId, date: new Date(date), value })
    .onConflictDoUpdate({ target: [economicIndicators.country, economicIndicators.indicator, economicIndicators.date], set: { value, fetchedAt: new Date() } });
}

export async function upsertEconomicEvent(event: NormalizedEconomicEvent, affectedMarkets: string[]): Promise<void> {
  const db = getDb();
  await db
    .insert(economicEvents)
    .values({
      externalId: event.id,
      country: event.country,
      event: event.event,
      dateTime: new Date(event.dateTime),
      impact: event.impact,
      actual: event.actual,
      previous: event.previous,
      forecast: event.forecast,
      affectedMarkets,
    })
    .onConflictDoUpdate({
      target: economicEvents.externalId,
      set: { actual: event.actual, previous: event.previous, forecast: event.forecast, fetchedAt: new Date() },
    });
}

export async function insertNewsArticle(article: NormalizedNewsArticle, analysis: { interpretation: string; importance: number; confidence: number; reason: string }): Promise<void> {
  const db = getDb();
  await db
    .insert(newsArticles)
    .values({
      headline: article.headline,
      source: article.source,
      url: article.url,
      publishedAt: new Date(article.publishedAt),
      affectedMarkets: article.symbols,
      interpretation: analysis.interpretation,
      importance: analysis.importance,
      confidence: analysis.confidence,
      reason: analysis.reason,
    })
    .onConflictDoNothing({ target: newsArticles.url });
}

export type StoredPrice = {
  price: number;
  changePct24h: number;
  provider: string;
  sourceUpdatedAt: Date | null;
  fetchedAt: Date;
};

/** The single stored row for this symbol (market_prices is upserted, one
 * row per symbol) — or null if there has never been one, the only case
 * that should ever surface as UNAVAILABLE to a last-known-good fallback. */
export async function getLatestStoredPrice(symbol: string): Promise<StoredPrice | null> {
  const db = getDb();
  const rows = await db.select().from(marketPrices).where(eq(marketPrices.symbol, symbol)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return { price: r.price, changePct24h: r.changePct24h, provider: r.provider, sourceUpdatedAt: r.sourceUpdatedAt, fetchedAt: r.fetchedAt };
}

export type StoredDailyCandles = { candles: NormalizedCandle[]; fetchedAt: Date };

/** All stored daily candles for this symbol, oldest first, plus the most
 * recent `fetched_at` across those rows (when we last successfully wrote
 * any of them) — the timestamp a last-known-good fallback should report as
 * "as of", not the moment this function happens to be called. */
export async function getLatestStoredDailyCandles(symbol: string): Promise<StoredDailyCandles | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(marketCandles)
    .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.timeframe, "1d")))
    .orderBy(marketCandles.date);
  if (rows.length === 0) return null;

  const candles: NormalizedCandle[] = rows.map((r) => ({ date: r.date.toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const fetchedAt = rows.reduce((max, r) => (r.fetchedAt > max ? r.fetchedAt : max), rows[0].fetchedAt);
  return { candles, fetchedAt };
}

