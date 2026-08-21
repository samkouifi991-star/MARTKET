// Read-only verification for the second-phase 5-market batch (EURUSD,
// USDJPY, XAUUSD, BTCUSD, SPX500) before promoting them to
// STRICT_LIVE_SYMBOLS. Deliberately does NOT call any live provider API —
// FMP/CFTC/FRED/Myfxbook have all been rate-limited earlier this session,
// and the daily ingestion crons already run for every instrument in
// src/lib/instruments.ts regardless of strict-live status, so real stored
// data should already exist in Neon if the pipeline has been healthy. This
// only reads what's actually stored and reports it — same principle as the
// storage-first architecture itself.
//
// Usage: npm run test:five-market-verify
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { economicIndicators, institutionalPositioning, marketCandles, marketPrices, retailSentiment as retailSentimentTable } from "../src/db/schema";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { getInstrument } from "../src/lib/instruments";
import { CCY_TO_COUNTRY } from "../src/lib/scoring";
import { computeCurrentMonthStat, computeHistoricalSampleDepth } from "../src/lib/engines/seasonality";
import { seasonalityDepthFreshness } from "../src/lib/pipeline/types";
import { NormalizedCandle } from "../src/services/types";
import { DATA_MODE } from "../src/services/data-mode";

// Third-phase batch: AUDUSD, USDCAD, XAGUSD, NAS100, DJ30.
const SYMBOLS = ["AUDUSD", "USDCAD", "XAGUSD", "NAS100", "DJ30"];
const MACRO_INDICATORS = ["realGdp", "gdpGrowth", "industrialProduction", "retailSales", "cpi", "coreCpi", "pce", "corePce", "ppi", "unemploymentRate", "payrolls", "initialClaims", "wageGrowth", "laborParticipation", "policyRate"];

function log(msg: string): void {
  console.log(`FIVE_MARKET_VERIFY: ${msg}`);
}

function ageHours(d: Date | null): string {
  if (!d) return "n/a";
  return `${((Date.now() - d.getTime()) / 3_600_000).toFixed(1)}h`;
}

async function main() {
  log(`DATA_MODE=${DATA_MODE}`);
  const db = getDb();

  for (const symbol of SYMBOLS) {
    log(`==== ${symbol} ====`);
    const instrument = getInstrument(symbol);
    const mapping = getSymbolMapping(symbol);
    log(`instrument: assetClass=${instrument?.assetClass} currencies=${instrument?.currencies?.join("/") ?? "none (no two-country differential — macro uses US risk-proxy)"}`);
    log(`fmp ticker: ${mapping?.fmp.ticker} (kind=${mapping?.fmp.kind})`);
    log(`cftc mapping: ${mapping?.cftc ? `${mapping.cftc.reportType} — "${mapping.cftc.reportName}"` : "null (institutional/smartMoney will report NOT_APPLICABLE)"}`);
    log(`myfxbookSymbol: ${mapping?.myfxbookSymbol ?? "null"}; igEpic: ${mapping?.igEpic ?? "null"}${!mapping?.myfxbookSymbol && !mapping?.igEpic ? " -> retailSentiment will report NOT_APPLICABLE" : ""}`);

    // ---- Price ----
    const [priceRow] = await db.select().from(marketPrices).where(eq(marketPrices.symbol, symbol));
    if (priceRow) {
      log(`STORED_PRICE price=${priceRow.price} changePct24h=${priceRow.changePct24h} sourceUpdatedAt=${priceRow.sourceUpdatedAt?.toISOString() ?? "null"} fetchedAt=${priceRow.fetchedAt.toISOString()} (age ${ageHours(priceRow.fetchedAt)})`);
    } else {
      log(`STORED_PRICE none — no market_prices row yet for ${symbol}`);
    }

    // ---- Daily candles / Technical / Seasonality ----
    const dailyRows = await db
      .select()
      .from(marketCandles)
      .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.timeframe, "1d")))
      .orderBy(marketCandles.date);
    log(`STORED_DAILY_CANDLES count=${dailyRows.length}`);
    if (dailyRows.length >= 2) {
      const candles: NormalizedCandle[] = dailyRows.map((r) => ({ date: r.date.toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
      const depth = computeHistoricalSampleDepth(candles);
      const monthStat = computeCurrentMonthStat(candles);
      if (depth) {
        const tier = seasonalityDepthFreshness(depth.yearsSpanned);
        log(`SEASONALITY_DEPTH years=${depth.yearsSpanned} calendarYears=${depth.calendarYears} observations=${depth.observations} span=${depth.earliestDate} to ${depth.latestDate} positiveYearPct=${depth.positiveYearPct} avgAnnualReturn=${depth.avgAnnualReturn} medianAnnualReturn=${depth.medianAnnualReturn} -> tier=${tier}${tier === "unavailable" ? " (below 3y minimum — Seasonality will report INSUFFICIENT_HISTORY until more history accumulates)" : ""}`);
      }
      log(`TECHNICAL: ${dailyRows.length} daily candles available — sufficient for SMA/RSI/ADX/ROC (needs 200+ for SMA200; ${dailyRows.length >= 200 ? "OK" : "below 200, SMA200 will be null until more accumulate"})`);
      log(`CURRENT_MONTH_STAT period=${monthStat?.period ?? "n/a"} occurrences=${monthStat?.years ?? 0} (informational — real gating now uses SEASONALITY_DEPTH.years above, not this count)`);
    } else {
      log(`SEASONALITY_DEPTH n/a — fewer than 2 stored daily candles`);
    }

    // ---- CFTC institutional positioning ----
    if (mapping?.cftc) {
      const [posRow] = await db
        .select()
        .from(institutionalPositioning)
        .where(eq(institutionalPositioning.symbol, symbol))
        .orderBy(desc(institutionalPositioning.reportDate))
        .limit(1);
      if (posRow) {
        log(`STORED_CFTC classification=${posRow.classification} reportDate=${posRow.reportDate.toISOString()} netPositioning=${posRow.netPositioning} pctLong=${posRow.pctLong} fetchedAt=${posRow.fetchedAt.toISOString()} (age ${ageHours(posRow.fetchedAt)})`);
      } else {
        log(`STORED_CFTC none — mapping exists but no institutional_positioning row stored yet for ${symbol}`);
      }
    }

    // ---- Retail sentiment ----
    if (mapping?.myfxbookSymbol || mapping?.igEpic) {
      const [sentRow] = await db.select().from(retailSentimentTable).where(eq(retailSentimentTable.symbol, symbol)).orderBy(desc(retailSentimentTable.fetchedAt)).limit(1);
      if (sentRow) {
        log(`STORED_RETAIL_SENTIMENT pctLong=${sentRow.pctLong} pctShort=${sentRow.pctShort} provider=${sentRow.provider} status=${sentRow.status} fetchedAt=${sentRow.fetchedAt.toISOString()} (age ${ageHours(sentRow.fetchedAt)})`);
      } else {
        log(`STORED_RETAIL_SENTIMENT none — mapping exists but no retail_sentiment row stored yet for ${symbol}`);
      }
    }

    // ---- FRED / macro coverage ----
    const countries = instrument?.currencies ? instrument.currencies.map((c) => CCY_TO_COUNTRY[c]) : ["US"];
    for (const country of countries) {
      const rows = await db.select().from(economicIndicators).where(eq(economicIndicators.country, country));
      const indicatorsCovered = new Set(rows.map((r) => r.indicator));
      const missing = MACRO_INDICATORS.filter((k) => !indicatorsCovered.has(k));
      log(`FRED_COVERAGE country=${country} storedRows=${rows.length} indicatorsCovered=${indicatorsCovered.size}/${MACRO_INDICATORS.length}${missing.length ? ` missing=[${missing.join(",")}]` : ""}`);
    }
  }

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
