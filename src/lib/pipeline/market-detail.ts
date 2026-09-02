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
//
// The price card itself now lives in price.ts, not here — it's the same
// canonical, storage-only resolver Top Setups/Dashboard/Markets/Heatmap/
// Watchlists/the landing page all call too, so this page can never show a
// different current price for a symbol than any other surface does.
import { unstable_cache } from "next/cache";
import { getInstrument } from "@/lib/instruments";
import { publicInstruments } from "@/services/market-coverage";
import { generatePositioning } from "@/lib/demo/positioning";
import { currentMonthStat as demoCurrentMonthStat } from "@/lib/demo/seasonality";
import { upcomingHighImpact } from "@/lib/demo/calendar";
import { computeCurrentMonthStat, computeHistoricalSampleDepth, computeMonthlySeasonality, computeWeekdaySeasonality } from "@/lib/engines/seasonality";
import { formatPrice } from "@/lib/format";
import { Instrument, MarketScore, PriceData, SeasonalityStat } from "@/lib/types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";
import { getDailyCandlesWithFallback, getPositioningWithFallback, getRetailSentimentFromStorage } from "@/services/market-data/last-known-good";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";
import { getSymbolMapping } from "@/services/market-data/symbol-map";
import { CardResult, isUsable, seasonalityDepthFreshness, worseOf } from "./types";
import { resolveSmartMoney } from "./positioning";
import { getCanonicalPriceCard } from "./price";
import { withCacheFallback } from "@/lib/cache-fallback";

// Egress fix, phase 2: seasonality's own candle read (20*365 days — up to
// ~7,300 rows, by far the single largest read on this page) and CFTC's
// weekly-cadence report both change far slower than a 45s AutoRefresh
// cycle warrants re-reading them. CFTC publishes once a week and
// seasonality's underlying history is, by definition, historical — an
// hours-scale cache is still far fresher than either source actually
// updates. See technical.ts's cachedDailyCandles/H4/H1 for the same
// pattern applied to the price chart.
const cachedSeasonalityCandles = unstable_cache((symbol: string) => getDailyCandlesWithFallback(symbol, 20 * 365), ["mkt-detail-seasonality-candles"], { revalidate: 4 * 3600 });
const cachedPositioning = unstable_cache((symbol: string) => getPositioningWithFallback(symbol), ["mkt-detail-positioning"], { revalidate: 3 * 3600 });

export type InstitutionalCardData = {
  classification: string;
  longContracts: number;
  shortContracts: number;
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

export const MIN_YEARS_FOR_LIVE_SEASONALITY = 3;

async function institutionalCard(symbol: string, mode: DataMode): Promise<CardResult<InstitutionalCardData>> {
  // Storage-first: live CFTC call first, falls back to the last stored
  // report (DELAYED/STALE) on failure — see last-known-good.ts. Cached
  // (see cachedPositioning above) since a real CFTC report only publishes
  // weekly — re-fetching on every 45s AutoRefresh buys nothing.
  const result = await withCacheFallback(() => cachedPositioning(symbol), () => getPositioningWithFallback(symbol));
  if (result.value) {
    const v = result.value;
    return {
      data: {
        classification: v.classification,
        longContracts: v.longContracts,
        shortContracts: v.shortContracts,
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
      freshness: result.status, // "live", "delayed", or "stale" — a report beyond CFTC's freshness limit never reaches here with a value
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
        longContracts: demo.longContracts,
        shortContracts: demo.shortContracts,
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
  if (!mapping?.oandaInstrument && !mapping?.igEpic && !mapping?.myfxbookSymbol) {
    return { data: null, freshness: "not_applicable", source: "Retail Sentiment", lastUpdated: null, reason: `No retail-sentiment provider (OANDA/IG/Myfxbook) covers ${symbol} in the current provider set` };
  }
  // Storage-first — reads Neon only, never a live provider call (see
  // last-known-good.ts's file header on why OANDA is never called from a
  // page render).
  const result = await getRetailSentimentFromStorage(symbol);
  if (isUsable(result.status, result.value)) {
    return { data: result.value, freshness: result.status, source: result.source, lastUpdated: result.sourceUpdatedAt };
  }
  return { data: null, freshness: result.status === "error" ? "error" : "unavailable", source: result.source, lastUpdated: null, reason: result.error };
}

async function smartMoneyCard(symbol: string): Promise<CardResult<SmartMoneyCardData>> {
  const result = await resolveSmartMoney(symbol);
  if (result.freshness === "unavailable" || result.freshness === "error" || result.freshness === "not_applicable") {
    return { data: null, freshness: result.freshness, source: result.provider, lastUpdated: null, reason: result.explanation };
  }
  return {
    data: { signal: result.signal, confidence: result.confidence, explanation: result.explanation },
    freshness: result.freshness,
    source: result.provider,
    lastUpdated: new Date().toISOString(),
  };
}

async function seasonalityCard(symbol: string, mode: DataMode): Promise<CardResult<SeasonalityStat>> {
  // Cached (see cachedSeasonalityCandles above) — by far the largest single
  // read on this page (up to ~7,300 rows) for a statistic that, by
  // definition, only changes as slowly as history itself does.
  const history = await withCacheFallback(() => cachedSeasonalityCandles(symbol), () => getDailyCandlesWithFallback(symbol, 20 * 365));
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

export type LiveMarketDetail = {
  price: CardResult<PriceData>;
  institutional: CardResult<InstitutionalCardData>;
  retail: CardResult<NormalizedRetailSentiment>;
  smartMoney: CardResult<SmartMoneyCardData>;
  seasonality: CardResult<SeasonalityStat>;
};

export async function getLiveMarketDetail(symbol: string, mode: DataMode): Promise<LiveMarketDetail> {
  const [price, institutional, retail, smartMoney, seasonality] = await Promise.all([
    // cacheHistorical: true — this page's own chart is the one caller that
    // opts into caching the daily/H4/H1 candle reads behind current price
    // (see technical.ts). getQuoteWithFallback (current price itself)
    // stays uncached and refreshes on every call, same as always.
    getCanonicalPriceCard(symbol, mode, { cacheHistorical: true }),
    institutionalCard(symbol, mode),
    retailCard(symbol),
    smartMoneyCard(symbol),
    seasonalityCard(symbol, mode),
  ]);
  return { price, institutional, retail, smartMoney, seasonality };
}

// Phase 18 (public-launch demo sweep): the aggregate Institutional
// Positioning / Retail Sentiment / Smart Money / Seasonality pages used to
// call the pure demo generators for every INSTRUMENT unconditionally,
// regardless of DATA_MODE — real numbers were available (this same
// getLiveMarketDetail already powers the Scorecard) but those pages never
// called it. This is the shared "one real card set per publicly-launchable
// market" fetch those pages now use instead — restricted to
// publicInstruments() (LAUNCH_READY only), matching every other public
// surface (Dashboard, Top Setups, Markets) since Phase 1.
export async function getAllLiveMarketDetails(mode: DataMode): Promise<{ instrument: Instrument; detail: LiveMarketDetail }[]> {
  const instruments = publicInstruments();
  const details = await Promise.all(instruments.map((i) => getLiveMarketDetail(i.symbol, mode)));
  return instruments.map((instrument, i) => ({ instrument, detail: details[i] }));
}

// Same Phase 18 motivation as getAllLiveMarketDetails above, for the
// dedicated Seasonality page — which needs the FULL monthly/weekday
// breakdown (computeMonthlySeasonality/computeWeekdaySeasonality), not just
// seasonalityCard's single current-month stat. Same MIN_YEARS_FOR_LIVE_SEASONALITY
// gate and demo-candle-history source as seasonalityCard, just not
// restricted to the current calendar month.
export type LiveSeasonalityResult = { monthly: SeasonalityStat[]; weekday: SeasonalityStat[] } | null;

export async function getAllLiveSeasonality(): Promise<{ instrument: Instrument; result: LiveSeasonalityResult; unavailableReason: string | null }[]> {
  const instruments = publicInstruments();
  return Promise.all(
    instruments.map(async (instrument) => {
      const history = await getDailyCandlesWithFallback(instrument.symbol, 20 * 365);
      if (isUsable(history.status, history.value)) {
        const depth = computeHistoricalSampleDepth(history.value!);
        if (depth && depth.yearsSpanned >= MIN_YEARS_FOR_LIVE_SEASONALITY) {
          return { instrument, result: { monthly: computeMonthlySeasonality(history.value!), weekday: computeWeekdaySeasonality(history.value!) }, unavailableReason: null };
        }
        return {
          instrument,
          result: null,
          unavailableReason: `Only ${depth?.yearsSpanned ?? 0} year(s) of real stored history — below the ${MIN_YEARS_FOR_LIVE_SEASONALITY}-year minimum for a live seasonality read.`,
        };
      }
      return { instrument, result: null, unavailableReason: history.error ?? "Historical price data currently unavailable." };
    })
  );
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
