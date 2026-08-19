// Read-side counts for the GBPUSD validation admin page — proves real rows
// exist in raw storage for the reference market, not just that a fetch
// succeeded. Scoped to GBPUSD (and US/GB for the country-keyed FRED table)
// rather than a generic "count everything" query, since the page is
// specifically validating one market's dependency chain end to end.
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../client";
import { economicIndicators, institutionalPositioning, marketCandles, marketPrices, newsArticles, retailSentiment } from "../schema";

export type GbpusdRecordCounts = {
  marketPrices: number;
  marketCandlesDaily: number;
  marketCandles4h: number;
  marketCandles1h: number;
  institutionalPositioning: number;
  retailSentiment: number;
  economicIndicatorsUS: number;
  economicIndicatorsGB: number;
};

async function countRows(query: Promise<{ value: number }[]>): Promise<number> {
  const rows = await query;
  return rows[0]?.value ?? 0;
}

export async function getGbpusdRecordCounts(): Promise<GbpusdRecordCounts> {
  const db = getDb();
  const SYMBOL = "GBPUSD";

  const [prices, daily, h4, h1, positioning, retail, usIndicators, gbIndicators] = await Promise.all([
    countRows(db.select({ value: count() }).from(marketPrices).where(eq(marketPrices.symbol, SYMBOL))),
    countRows(db.select({ value: count() }).from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "1d")))),
    countRows(db.select({ value: count() }).from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "4h")))),
    countRows(db.select({ value: count() }).from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "1h")))),
    countRows(db.select({ value: count() }).from(institutionalPositioning).where(eq(institutionalPositioning.symbol, SYMBOL))),
    countRows(db.select({ value: count() }).from(retailSentiment).where(eq(retailSentiment.symbol, SYMBOL))),
    countRows(db.select({ value: count() }).from(economicIndicators).where(inArray(economicIndicators.country, ["US"]))),
    countRows(db.select({ value: count() }).from(economicIndicators).where(inArray(economicIndicators.country, ["GB"]))),
  ]);

  return {
    marketPrices: prices,
    marketCandlesDaily: daily,
    marketCandles4h: h4,
    marketCandles1h: h1,
    institutionalPositioning: positioning,
    retailSentiment: retail,
    economicIndicatorsUS: usIndicators,
    economicIndicatorsGB: gbIndicators,
  };
}

// ---- Storage-first snapshot: everything the redesigned validation page
// needs, read from raw storage — no provider calls. `lastFetchedAt` is when
// we wrote the row (our own timestamp); `latestSourceDate` is the date/period
// the data itself covers (e.g. the daily bar's date, the FRED observation
// date, the CFTC report date) — the two are deliberately kept distinct since
// conflating them is exactly what produced the impossible-future-timestamp
// bug fixed earlier this project.
export type DatasetSnapshot = {
  count: number;
  lastFetchedAt: string | null;
  latestSourceDate: string | null;
};

export type GbpusdStorageSnapshot = {
  price: (DatasetSnapshot & { value: number | null; status: string | null }) | null;
  candlesDaily: DatasetSnapshot;
  candles4h: DatasetSnapshot;
  candles1h: DatasetSnapshot;
  positioning: DatasetSnapshot;
  retailSentiment: DatasetSnapshot;
  news: DatasetSnapshot;
  economicIndicators: Record<string, DatasetSnapshot>; // keyed "US:cpi", "GB:gdpGrowth", ...
};

function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function getGbpusdStorageSnapshot(): Promise<GbpusdStorageSnapshot> {
  const db = getDb();
  const SYMBOL = "GBPUSD";

  const [priceRows, candleStats, positioningStats, retailStats, newsStats, indicatorStats] = await Promise.all([
    db.select().from(marketPrices).where(eq(marketPrices.symbol, SYMBOL)).limit(1),
    db
      .select({
        timeframe: marketCandles.timeframe,
        latestDate: sql<string>`max(${marketCandles.date})`,
        lastFetchedAt: sql<string>`max(${marketCandles.fetchedAt})`,
        count: count(),
      })
      .from(marketCandles)
      .where(eq(marketCandles.symbol, SYMBOL))
      .groupBy(marketCandles.timeframe),
    db
      .select({
        latestDate: sql<string>`max(${institutionalPositioning.reportDate})`,
        lastFetchedAt: sql<string>`max(${institutionalPositioning.fetchedAt})`,
        count: count(),
      })
      .from(institutionalPositioning)
      .where(eq(institutionalPositioning.symbol, SYMBOL)),
    db
      .select({
        lastFetchedAt: sql<string>`max(${retailSentiment.fetchedAt})`,
        count: count(),
      })
      .from(retailSentiment)
      .where(eq(retailSentiment.symbol, SYMBOL)),
    // newsArticles has no symbol column, only a jsonb affectedMarkets array
    // — filtered via Postgres jsonb containment rather than pulled and
    // filtered client-side.
    db
      .select({
        latestDate: sql<string>`max(${newsArticles.publishedAt})`,
        lastFetchedAt: sql<string>`max(${newsArticles.fetchedAt})`,
        count: count(),
      })
      .from(newsArticles)
      .where(sql`${newsArticles.affectedMarkets} @> ${JSON.stringify([SYMBOL])}::jsonb`),
    db
      .select({
        country: economicIndicators.country,
        indicator: economicIndicators.indicator,
        latestDate: sql<string>`max(${economicIndicators.date})`,
        lastFetchedAt: sql<string>`max(${economicIndicators.fetchedAt})`,
        count: count(),
      })
      .from(economicIndicators)
      .where(inArray(economicIndicators.country, ["US", "GB"]))
      .groupBy(economicIndicators.country, economicIndicators.indicator),
  ]);

  const candleByTf = new Map(candleStats.map((r) => [r.timeframe, r]));
  const toSnapshot = (r: { latestDate?: string | null; lastFetchedAt?: string | null; count: number } | undefined): DatasetSnapshot => ({
    count: r?.count ?? 0,
    lastFetchedAt: toIso(r?.lastFetchedAt),
    latestSourceDate: toIso(r?.latestDate),
  });

  const economicIndicatorSnapshot: Record<string, DatasetSnapshot> = {};
  for (const row of indicatorStats) {
    economicIndicatorSnapshot[`${row.country}:${row.indicator}`] = toSnapshot(row);
  }

  const price = priceRows[0]
    ? {
        count: 1,
        value: priceRows[0].price,
        status: priceRows[0].status,
        lastFetchedAt: toIso(priceRows[0].fetchedAt),
        latestSourceDate: toIso(priceRows[0].sourceUpdatedAt),
      }
    : null;

  return {
    price,
    candlesDaily: toSnapshot(candleByTf.get("1d")),
    candles4h: toSnapshot(candleByTf.get("4h")),
    candles1h: toSnapshot(candleByTf.get("1h")),
    positioning: toSnapshot(positioningStats[0]),
    retailSentiment: toSnapshot(retailStats[0]),
    news: toSnapshot(newsStats[0]),
    economicIndicators: economicIndicatorSnapshot,
  };
}
