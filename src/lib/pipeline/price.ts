// The single canonical current-price resolver for every UI surface — Top
// Setups, Dashboard, Markets, Heatmap, Watchlists, Market Detail, and the
// landing page all call this SAME function (directly, or via
// top-setups.ts's getCanonicalMarketRows) instead of generating or
// independently fetching their own price, so a symbol can never show two
// different current prices across pages.
//
// This exists to fix exactly the regression reported: ETHUSD showing
// 3,589.87 on Top Setups (lib/demo/price.ts's generatePriceData — a
// deterministic-but-fake demo generator that Top Setups fell back to for
// price even outside demo mode, see this file's git history) while Market
// Detail separately called the live provider chain and rendered the real
// 2,424.77. Both numbers were "real code paths," but they were two
// different code paths reading two different sources for the same symbol.
//
// Architecture: Provider (OANDA primary for FX, FMP otherwise — unchanged,
// see market-data-router.ts) -> scheduled ingestion cron (cron/prices,
// cron/candles) -> canonical Neon row (market_prices, upserted one row per
// symbol — already the "current price" table this task asked for; see
// schema.ts's own header) -> every UI surface reads that same row via this
// function. storageOnly is always true on both underlying reads below —
// no OANDA/FMP call is ever made from a UI render, matching the rule
// already enforced for CFTC/FRED/retail sentiment (see
// last-known-good.ts's file header). Only the scheduled ingestion crons
// ever call a live provider for price/candles.
import { getInstrument } from "@/lib/instruments";
import { generatePriceData } from "@/lib/demo/price";
import { getQuoteWithFallback } from "@/services/market-data/last-known-good";
import { PriceData } from "@/lib/types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";
import { CardResult, isUsable, worseOf } from "./types";
import { fetchTechnicalTrend, TechnicalTrendOptions } from "./technical";

export async function getCanonicalPriceCard(symbol: string, mode: DataMode, technicalOpts: TechnicalTrendOptions = {}): Promise<CardResult<PriceData>> {
  const [quote, technical] = await Promise.all([getQuoteWithFallback(symbol, true), fetchTechnicalTrend(symbol, true, technicalOpts)]);

  if (isUsable(quote.status, quote.value) && isUsable(technical.daily.status, technical.daily.value) && technical.result) {
    const t = technical.result;
    const series = technical.daily.value!.map((c) => ({ date: c.date, price: c.close }));
    const freshness = worseOf(quote.status, technical.daily.status);
    const fromStorage = quote.source.includes("last known good") || technical.daily.source.includes("last known good");
    return {
      data: {
        symbol,
        current: quote.value!.price,
        changePct24h: quote.value!.changePct24h,
        series,
        ema20: t.sma20 ?? quote.value!.price,
        sma50: t.sma50 ?? quote.value!.price,
        sma100: t.sma100 ?? quote.value!.price,
        sma200: t.sma200 ?? quote.value!.price,
        rsi14: t.rsi14 ?? 50,
        adx14: t.adx14 ?? 0,
        roc10: t.roc10 ?? 0,
        structure: t.structure,
      },
      freshness,
      source: fromStorage ? "Financial Modeling Prep — last known good" : "Financial Modeling Prep",
      lastUpdated: quote.sourceUpdatedAt,
    };
  }
  if (allowsDemoFallback(mode, symbol)) {
    const instrument = getInstrument(symbol)!;
    return { data: generatePriceData(instrument), freshness: "estimated", source: "Simulated price engine (demo)", lastUpdated: new Date().toISOString() };
  }
  const failure = !isUsable(quote.status, quote.value) ? quote : technical.daily;
  return { data: null, freshness: failure.status === "error" ? "error" : "unavailable", source: "Financial Modeling Prep", lastUpdated: null, reason: failure.error ?? "Insufficient candle history to compute indicators" };
}
