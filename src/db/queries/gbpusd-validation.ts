// Read-side counts for the GBPUSD validation admin page — proves real rows
// exist in raw storage for the reference market, not just that a fetch
// succeeded. Scoped to GBPUSD (and US/GB for the country-keyed FRED table)
// rather than a generic "count everything" query, since the page is
// specifically validating one market's dependency chain end to end.
import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "../client";
import { economicIndicators, institutionalPositioning, marketCandles, marketPrices, retailSentiment } from "../schema";

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
