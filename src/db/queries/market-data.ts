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
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../client";
import { marketPrices, marketCandles, institutionalPositioning, retailSentiment, economicIndicators, economicEvents, newsArticles } from "../schema";
import { FredSeriesPoint, NormalizedCandle, NormalizedEconomicEvent, NormalizedNewsArticle, NormalizedQuote } from "@/services/types";
import { CftcPositioningResult } from "@/services/market-data/cftc";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { EconomicIndicatorKey } from "@/services/economic-calendar/indicator-taxonomy";

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
        // provider must update too — otherwise a bar first written during a
        // provider's outage (e.g. an FMP fallback row) stays mislabeled
        // forever even after the primary provider (OANDA for FX) re-writes
        // the same date with corrected values on a later, healthy run.
        set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume`, provider: sql`excluded.provider`, fetchedAt: new Date() },
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

export async function insertRetailSentiment(symbol: string, pctLong: number, pctShort: number, status: string, provider?: string, source?: string, sourceUpdatedAt?: string | null): Promise<void> {
  const db = getDb();
  await db.insert(retailSentiment).values({
    symbol,
    pctLong,
    pctShort,
    status,
    ...(provider ? { provider } : {}),
    ...(source ? { source } : {}),
    ...(sourceUpdatedAt ? { sourceUpdatedAt: new Date(sourceUpdatedAt) } : {}),
  });
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

/** Backfills the V2-only classification columns (indicatorKey,
 * importanceTier, revisedPrevious) onto an already-upserted economic_events
 * row — kept as its own function, separate from upsertEconomicEvent above,
 * so the V1 calendar cron's existing call site needs zero changes. Only
 * app/api/cron/economic-releases/route.ts (V2's release-detection cron)
 * calls this. A no-op if the externalId doesn't exist yet (upsertEconomicEvent
 * must run first). */
export async function updateEconomicEventClassification(externalId: string, fields: { indicatorKey: string | null; importanceTier: string | null; revisedPrevious: number | null }): Promise<void> {
  const db = getDb();
  await db.update(economicEvents).set(fields).where(eq(economicEvents.externalId, externalId));
}

export type StoredEconomicEventRow = {
  event: string;
  dateTime: string;
  actual: number;
  previous: number | null;
  forecast: number | null;
  importanceTier: string | null;
};

/** The most recently RELEASED (actual IS NOT NULL) stored calendar event
 * for a given country/indicatorKey pair — the market scorecard's Economic
 * Growth/Inflation/Jobs Market rows read this (never a live FMP call from
 * the render path, matching this project's storage-first rule everywhere
 * else). Reads economic_events, V1's own table (indicatorKey is a nullable
 * V2-classification column backfilled onto it, not a separate V2 table —
 * see updateEconomicEventClassification above) — this is real calendar
 * history, not fabricated. Returns null, never a stub row, when nothing
 * classified as this indicator has been released yet for this country. */
export async function getLatestEconomicEventByIndicator(country: string, indicatorKey: EconomicIndicatorKey): Promise<StoredEconomicEventRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(economicEvents)
    .where(and(eq(economicEvents.country, country), eq(economicEvents.indicatorKey, indicatorKey), isNotNull(economicEvents.actual)))
    .orderBy(desc(economicEvents.dateTime))
    .limit(1);
  const r = rows[0];
  if (!r || r.actual === null) return null;
  return { event: r.event, dateTime: r.dateTime.toISOString(), actual: r.actual, previous: r.previous, forecast: r.forecast, importanceTier: r.importanceTier };
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

export type StoredPositioning = { positioning: CftcPositioningResult; fetchedAt: Date };

/** The latest stored CFTC report for this symbol (any classification),
 * reconstructed into the exact same CftcPositioningResult shape the live
 * client returns — including netHistory, rebuilt from every stored row for
 * that symbol/classification pair rather than stored redundantly per row.
 * marketAndExchangeName/cftcContractMarketCode aren't stored per row (pure
 * provenance metadata, not consumed by scoring) — recovered from
 * symbol-map.ts's own mapping instead of a guess. */
export async function getLatestStoredPositioning(symbol: string): Promise<StoredPositioning | null> {
  const db = getDb();
  const latestRows = await db.select().from(institutionalPositioning).where(eq(institutionalPositioning.symbol, symbol)).orderBy(desc(institutionalPositioning.reportDate)).limit(1);
  const latest = latestRows[0];
  if (!latest) return null;

  const historyRows = await db
    .select({ reportDate: institutionalPositioning.reportDate, netPositioning: institutionalPositioning.netPositioning })
    .from(institutionalPositioning)
    .where(and(eq(institutionalPositioning.symbol, symbol), eq(institutionalPositioning.classification, latest.classification)))
    .orderBy(desc(institutionalPositioning.reportDate))
    .limit(160); // ~3 years of weekly reports, matching the live client's own window

  const netHistory = historyRows.map((r) => ({ reportDate: r.reportDate.toISOString(), netPositioning: r.netPositioning }));

  return {
    positioning: {
      classification: latest.classification,
      reportDate: latest.reportDate.toISOString(),
      longContracts: latest.longContracts,
      shortContracts: latest.shortContracts,
      netPositioning: latest.netPositioning,
      pctLong: latest.pctLong,
      pctShort: latest.pctShort,
      openInterest: latest.openInterest,
      netWeeklyChange: latest.netWeeklyChange,
      percentile1y: latest.percentile1y,
      percentile3y: latest.percentile3y,
      direction: latest.direction as CftcPositioningResult["direction"],
      strength: latest.strength as CftcPositioningResult["strength"],
      netHistory,
      marketAndExchangeName: getSymbolMapping(symbol)?.cftc?.reportName ?? "",
      cftcContractMarketCode: null,
    },
    fetchedAt: latest.fetchedAt,
  };
}

export type StoredRetailSentiment = {
  pctLong: number;
  pctShort: number;
  provider: string;
  source: string;
  fetchedAt: Date;
  /** The provider's own timestamp for this observation (e.g. OANDA
   * PositionBook's `time`) — freshness must be computed from this, not
   * fetchedAt. Null for rows written before this column existed, or from a
   * provider (IG/Myfxbook) that never had a real per-symbol timestamp to
   * begin with — callers fall back to fetchedAt only in that case. */
  sourceUpdatedAt: Date | null;
};

/** The latest stored retail-sentiment snapshot for this symbol — only ever
 * written from a genuinely live provider read (see insertRetailSentiment's
 * callers), so every stored row here is itself a real prior observation,
 * never a fabricated one. */
export async function getLatestStoredRetailSentiment(symbol: string): Promise<StoredRetailSentiment | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(retailSentiment)
    .where(and(eq(retailSentiment.symbol, symbol), eq(retailSentiment.status, "live")))
    .orderBy(desc(retailSentiment.fetchedAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { pctLong: r.pctLong, pctShort: r.pctShort, provider: r.provider, source: r.source, fetchedAt: r.fetchedAt, sourceUpdatedAt: r.sourceUpdatedAt };
}

export type StoredEconomicSeries = { points: FredSeriesPoint[]; fetchedAt: Date };

/** The most recent `limit` stored observations for a country/indicator,
 * oldest-first (matching fred.ts's own convention) — the storage-first
 * counterpart to fred.getSeries(), read from economic_indicators rather
 * than called live. */
export async function getLatestStoredEconomicSeries(country: string, indicator: FredIndicatorKey, limit = 24): Promise<StoredEconomicSeries | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(economicIndicators)
    .where(and(eq(economicIndicators.country, country), eq(economicIndicators.indicator, indicator)))
    .orderBy(desc(economicIndicators.date))
    .limit(limit);
  if (rows.length === 0) return null;

  const ascending = [...rows].reverse();
  const points: FredSeriesPoint[] = ascending.map((r) => ({ date: r.date.toISOString().slice(0, 10), value: r.value }));
  const fetchedAt = rows.reduce((max, r) => (r.fetchedAt > max ? r.fetchedAt : max), rows[0].fetchedAt);
  return { points, fetchedAt };
}

export type StoredDailyCandles = { candles: NormalizedCandle[]; fetchedAt: Date; provider: string };

/** All stored candles for this symbol/timeframe, oldest first, plus the most
 * recent `fetched_at` across those rows (when we last successfully wrote
 * any of them) — the timestamp a last-known-good fallback should report as
 * "as of", not the moment this function happens to be called — and the
 * provider that wrote the most recent (latest-dated) candle, so a
 * last-known-good fallback can report the series' TRUE current source
 * (e.g. "oanda") rather than assuming a fixed provider. Generalized over
 * timeframe so daily and intraday (4h/1h) share one implementation. */
export async function getLatestStoredCandles(symbol: string, timeframe: "1d" | "4h" | "1h"): Promise<StoredDailyCandles | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(marketCandles)
    .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.timeframe, timeframe)))
    .orderBy(marketCandles.date);
  if (rows.length === 0) return null;

  const candles: NormalizedCandle[] = rows.map((r) => ({ date: r.date.toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  const fetchedAt = rows.reduce((max, r) => (r.fetchedAt > max ? r.fetchedAt : max), rows[0].fetchedAt);
  const provider = rows[rows.length - 1].provider; // rows are ordered by date ascending — last row is the latest candle
  return { candles, fetchedAt, provider };
}

/** Daily-only convenience wrapper — kept as its own name since it's the
 * overwhelming majority of existing callers (Technical/Seasonality/price
 * chart all default to daily). */
export async function getLatestStoredDailyCandles(symbol: string): Promise<StoredDailyCandles | null> {
  return getLatestStoredCandles(symbol, "1d");
}

