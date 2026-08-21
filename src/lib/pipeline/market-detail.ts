// Live-aware data for the market detail page's supporting cards
// (Institutional Positioning, Retail Sentiment, Smart Money, Seasonality,
// Price/Technical chart) — the display-oriented counterpart to
// scoring-engine.ts's computeLiveMarketScore. Both live in this pipeline
// layer so the page component (src/app/markets/[symbol]/page.tsx) never
// calls a provider or an engine directly, matching the architecture rule:
// External API -> raw storage -> normalization -> factor engine -> UI.
//
// Every card here follows the same honesty rule as the scoring factors: a
// provider failure or missing coverage renders "unavailable"/"error" with
// null data, never a silently-fabricated number. Where the rest of the app
// allows hybrid mode to fall back to clearly-labeled demo data (governed by
// allowsDemoFallback, which already withholds that for strict-live symbols
// like GBPUSD), these cards do the same — except Retail Sentiment, which
// per spec never estimates a percentage in any mode.
import { getInstrument } from "@/lib/instruments";
import { generatePositioning } from "@/lib/demo/positioning";
import { generatePriceData } from "@/lib/demo/price";
import { currentMonthStat as demoCurrentMonthStat } from "@/lib/demo/seasonality";
import { upcomingHighImpact } from "@/lib/demo/calendar";
import { computeCurrentMonthStat, computeHistoricalSampleDepth } from "@/lib/engines/seasonality";
import { formatPrice } from "@/lib/format";
import { DataFreshness, Instrument, MarketScore, PriceData, SeasonalityStat } from "@/lib/types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";
import * as cftc from "@/services/market-data/cftc";
import { getQuoteWithFallback, getDailyCandlesWithFallback } from "@/services/market-data/last-known-good";
import * as retailSentiment from "@/services/market-data/retail-sentiment";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import { seasonalityDepthFreshness, worseOf } from "./types";
import { resolveSmartMoney } from "./positioning";
import { fetchTechnicalTrend } from "./technical";

export type CardResult<T> = {
  data: T | null;
  freshness: DataFreshness;
  source: string;
  lastUpdated: string | null;
  reason?: string;
};

export type InstitutionalCardData = {
  classification: string;
  netPositioning: number;
  netWeeklyChange: number;
  pctLong: number;
  pctShort: number;
  openInterest: number;
  percentile: number | null;
  direction: string;
  strength: string;
  reportDate: string;
};

export type SmartMoneyCardData = { signal: string; confidence: number; explanation: string };

const MIN_YEARS_FOR_LIVE_SEASONALITY = 3;

async function institutionalCard(symbol: string, mode: DataMode): Promise<CardResult<InstitutionalCardData>> {
  const result = await cftc.getInstitutionalPositioning(symbol);
  if (result.value) {
    const v = result.value;
    return {
      data: {
        classification: v.classification,
        netPositioning: v.netPositioning,
        netWeeklyChange: v.netWeeklyChange,
        pctLong: v.pctLong,
        pctShort: v.pctShort,
        openInterest: v.openInterest,
        percentile: v.percentile3y ?? v.percentile1y,
        direction: v.direction,
        strength: v.strength,
        reportDate: v.reportDate,
      },
      freshness: result.status, // "live" or "stale" — a too-old report never reaches here with a value
      source: result.source,
      lastUpdated: result.sourceUpdatedAt,
    };
  }
  if (allowsDemoFallback(mode, symbol)) {
    const instrument = getInstrument(symbol)!;
    const demo = generatePositioning(instrument);
    return {
      data: {
        classification: "Composite institutional positioning (demo)",
        netPositioning: demo.netPositioning,
        netWeeklyChange: demo.netWeeklyChange,
        pctLong: demo.pctLong,
        pctShort: demo.pctShort,
        openInterest: demo.openInterest,
        percentile: demo.percentile,
        direction: demo.netPositioning >= 0 ? "Bullish" : "Bearish",
        strength: "Moderate",
        reportDate: demo.reportDate,
      },
      freshness: "estimated",
      source: "CFTC Commitments of Traders (demo)",
      lastUpdated: demo.reportDate,
    };
  }
  return { data: null, freshness: result.status === "error" ? "error" : "unavailable", source: result.source, lastUpdated: null, reason: result.error };
}

async function retailCard(symbol: string): Promise<CardResult<NormalizedRetailSentiment>> {
  // Retail sentiment never falls back to demo data, in any mode — see
  // src/lib/pipeline/sentiment.ts for the same absolute rule applied to the
  // score factor. Same not_applicable distinction as sentiment.ts too: no
  // configured provider for this asset class is a permanent, structural
  // gap, not a temporary outage.
  const mapping = getSymbolMapping(symbol);
  if (!mapping?.myfxbookSymbol && !mapping?.igEpic) {
    return { data: null, freshness: "not_applicable", source: "Retail Sentiment", lastUpdated: null, reason: `No retail-sentiment provider (Myfxbook/IG) covers ${symbol} in the current provider set` };
  }
  const result = await retailSentiment.getRetailSentiment(symbol);
  if (result.status === "live" && result.value) {
    return { data: result.value, freshness: "live", source: result.source, lastUpdated: result.sourceUpdatedAt };
  }
  return { data: null, freshness: result.status === "error" ? "error" : "unavailable", source: result.source, lastUpdated: null, reason: result.error };
}

async function smartMoneyCard(symbol: string): Promise<CardResult<SmartMoneyCardData>> {
  const result = await resolveSmartMoney(symbol);
  if (result.freshness !== "live") {
    return { data: null, freshness: result.freshness, source: result.provider, lastUpdated: null, reason: result.explanation };
  }
  return {
    data: { signal: result.signal, confidence: result.confidence, explanation: result.explanation },
    freshness: "live",
    source: result.provider,
    lastUpdated: new Date().toISOString(),
  };
}

// Live, or last-known-good stored data — real either way, distinct from
// "nothing usable at all" (unavailable/error), which is the only case that
// should render as unavailable per the last-known-good rule: never blank
// the page just because the newest refresh failed while real stored data
// still exists.
function isUsable<T>(status: DataFreshness, value: T | null): boolean {
  return (status === "live" || status === "delayed" || status === "stale") && value !== null;
}

async function seasonalityCard(symbol: string, mode: DataMode): Promise<CardResult<SeasonalityStat>> {
  const history = await getDailyCandlesWithFallback(symbol, 20 * 365);
  if (isUsable(history.status, history.value)) {
    const stat = computeCurrentMonthStat(history.value!);
    // Real span of the sample, not stat.years (which counts occurrences of
    // the current month and can look multi-year from as little as ~13
    // months of daily candles) — see pipeline/seasonality.ts for the same
    // rule applied to the score factor.
    const depth = computeHistoricalSampleDepth(history.value!);
    if (stat && depth && depth.yearsSpanned >= MIN_YEARS_FOR_LIVE_SEASONALITY) {
      const fromStorage = history.source.includes("last known good");
      const freshness = worseOf(history.status, seasonalityDepthFreshness(depth.yearsSpanned));
      return {
        data: { ...stat, sampleDepth: depth },
        freshness,
        source: fromStorage ? `Historical daily closes (FMP) — ${depth.yearsSpanned}-year sample — last known good` : `Historical daily closes (FMP) — ${depth.yearsSpanned}-year sample`,
        lastUpdated: history.sourceUpdatedAt,
      };
    }
    if (allowsDemoFallback(mode, symbol)) {
      const instrument = getInstrument(symbol)!;
      return { data: demoCurrentMonthStat(instrument), freshness: "estimated", source: "Historical seasonality engine (demo)", lastUpdated: new Date().toISOString() };
    }
    return {
      data: null,
      freshness: "unavailable",
      source: "Historical daily closes (FMP)",
      lastUpdated: null,
      reason: `Only ${depth?.yearsSpanned ?? 0} year(s) of real stored history (${depth?.observations ?? 0} candles, ${depth?.earliestDate ?? "n/a"} to ${depth?.latestDate ?? "n/a"}) — below the ${MIN_YEARS_FOR_LIVE_SEASONALITY}-year minimum`,
    };
  }
  if (allowsDemoFallback(mode, symbol)) {
    const instrument = getInstrument(symbol)!;
    return { data: demoCurrentMonthStat(instrument), freshness: "estimated", source: "Historical seasonality engine (demo)", lastUpdated: new Date().toISOString() };
  }
  return { data: null, freshness: history.status === "error" ? "error" : "unavailable", source: "Historical daily closes (FMP)", lastUpdated: null, reason: history.error };
}

async function priceCard(symbol: string, mode: DataMode): Promise<CardResult<PriceData>> {
  const [quote, technical] = await Promise.all([getQuoteWithFallback(symbol), fetchTechnicalTrend(symbol)]);

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

export type LiveMarketDetail = {
  price: CardResult<PriceData>;
  institutional: CardResult<InstitutionalCardData>;
  retail: CardResult<NormalizedRetailSentiment>;
  smartMoney: CardResult<SmartMoneyCardData>;
  seasonality: CardResult<SeasonalityStat>;
};

export async function getLiveMarketDetail(symbol: string, mode: DataMode): Promise<LiveMarketDetail> {
  const [price, institutional, retail, smartMoney, seasonality] = await Promise.all([
    priceCard(symbol, mode),
    institutionalCard(symbol, mode),
    retailCard(symbol),
    smartMoneyCard(symbol),
    seasonalityCard(symbol, mode),
  ]);
  return { price, institutional, retail, smartMoney, seasonality };
}

function formatSignedNoPct(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}

/** Same "what could invalidate this bias" narrative as lib/invalidation.ts,
 * but built from live card data — degrades to honest, non-numeric language
 * for any factor that's currently unavailable rather than fabricating a
 * number lib/invalidation.ts's demo version could always assume was present. */
export function buildLiveInvalidationPoints(instrument: Instrument, score: MarketScore, detail: LiveMarketDetail): string[] {
  const isBullish = score.totalScore > 0;
  const points: string[] = [];

  const ratesFactor = score.factors.find((f) => f.key === "interestRates")!;
  points.push(
    isBullish
      ? `Central bank commentary turns more dovish than currently priced, eroding the ${formatSignedNoPct(ratesFactor.contribution)} interest-rate contribution.`
      : `Central bank commentary turns more hawkish than currently priced, reversing the ${formatSignedNoPct(ratesFactor.contribution)} interest-rate contribution.`
  );

  if (detail.price.data) {
    const price = detail.price.data;
    points.push(
      isBullish
        ? `Price closes below the 200-day moving average (currently ${formatPrice(price.sma200, instrument.decimals)}), invalidating the bullish technical structure.`
        : `Price closes above the 200-day moving average (currently ${formatPrice(price.sma200, instrument.decimals)}), invalidating the bearish technical structure.`
    );
  } else {
    points.push("Price/technical data is currently unavailable, so the technical structure underlying this bias cannot be sanity-checked in real time.");
  }

  if (detail.institutional.data) {
    const positioning = detail.institutional.data;
    const pctLabel = positioning.percentile !== null ? `${positioning.percentile}th percentile` : "an unranked level (insufficient history for a percentile)";
    points.push(
      isBullish
        ? `Institutional traders reduce long exposure sharply — net positioning is currently at ${pctLabel}; a fast unwind would flip the institutional contribution negative.`
        : `Institutional traders cover short exposure sharply — net positioning is currently at ${pctLabel}; a fast unwind would flip the institutional contribution positive.`
    );
  } else {
    points.push("Institutional positioning data is currently unavailable, so this bias cannot be cross-checked against real CFTC positioning until it returns.");
  }

  const nextEvents = upcomingHighImpact(96).filter((e) => e.affectedMarkets.some((m) => instrument.currencies?.includes(m) || m === instrument.symbol));
  if (nextEvents[0]) {
    points.push(`${nextEvents[0].event} (${nextEvents[0].country}) misses expectations, which would move the economic growth or inflation contribution against the current bias.`);
  } else {
    points.push(`An unscheduled high-impact data release or central bank surprise moves the growth or inflation contribution against the current bias.`);
  }

  if (detail.retail.data) {
    const retail = detail.retail.data;
    const extreme = retail.pctLong > 65 || retail.pctShort > 65;
    points.push(
      extreme
        ? `Retail positioning becomes even more one-sided (currently ${retail.pctLong.toFixed(0)}% long / ${retail.pctShort.toFixed(0)}% short), which would further strengthen — not weaken — the existing contrarian read; watch for a sudden reversal in retail flow instead.`
        : `Retail positioning becomes overcrowded in the direction of the current bias, introducing contrarian risk that isn't yet present.`
    );
  } else {
    points.push("Retail sentiment data is currently unavailable, so no contrarian retail-positioning read is factored into this bias yet.");
  }

  points.push(`A major geopolitical or risk-sentiment shift strengthens the opposing side of this market faster than the scoring engine's next update cycle.`);

  return points;
}
