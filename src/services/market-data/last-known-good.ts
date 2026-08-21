// Last-known-good fallback for the *display and scoring* path (not cron
// ingestion, which must stay pure-live — it's the thing that populates the
// storage this file reads back), covering every provider type: FMP quotes/
// candles, CFTC institutional positioning, FRED macro series, and retail
// sentiment. Architecture:
//   Provider -> scheduled ingestion -> Neon -> factor engine -> score -> UI
// The page should primarily reflect real stored data; a failed live refresh
// must degrade the freshness badge, not blank the page. Originally built to
// fix an outage where FMP 429s made a page with real 228-row Neon history
// for GBPUSD render as fully unavailable; extended to CFTC/FRED/retail
// sentiment so the whole provider layer follows the same architecture, not
// just price/candles.
//
// General rule (verbatim from the spec that motivated the FMP version): if
// the latest live call didn't return usable data, fall back to whatever was
// last actually stored — recent stored data reads DELAYED, older reads
// STALE, and only "there has never been a stored value at all" reads
// UNAVAILABLE. A stored value is never erased or hidden just because the
// newest refresh failed.
//
// One deliberate split by provider type, though: FMP quotes/candles treat
// any live status other than exactly "live" as a reason to check storage
// (there's no meaningful "live but old" reading for a price tick). CFTC and
// FRED both have their own real staleness concept baked into the live
// path itself (a CFTC report ages by report-date, a FRED series by
// observation-date) — a live call that comes back "stale" is still the
// freshest data obtainable, strictly at least as fresh as anything in
// storage, so only a genuine fetch failure (unavailable/error) triggers a
// storage read for those two (see liveFetchFailed below).
//
// Retail sentiment is a deliberate architectural exception to the whole
// "live first, storage as fallback" pattern above: the render/scoring path
// must NEVER call a retail-sentiment provider (OANDA/IG/Myfxbook) directly —
// only the scheduled cron (cron/retail-sentiment) does that, writing
// whatever it gets to Neon. getRetailSentimentFromStorage below only ever
// reads Neon — but its freshness is classified the same way CFTC/FRED's is
// above: by the age of the observation's OWN source timestamp
// (sourceUpdatedAt, e.g. OANDA PositionBook's `time`), not by how long ago
// the row happened to be written. A snapshot read from Neon a second after
// the cron wrote it is exactly as fresh as the OANDA data it carries, never
// automatically "delayed" just because the read came from storage; storage
// provenance (fetchedAt) is tracked on the row but never drives freshness.
// This keeps provider request volume to the cron's own cadence, never one
// call per page view.
import * as marketData from "./market-data-router";
import * as cftc from "./cftc";
import * as fred from "./fred";
import { CftcPositioningResult, isCftcReportWithinFreshnessLimit } from "./cftc";
import { classifyFredFreshness } from "./fred";
import { FredIndicatorKey } from "./fred-series";
import { NormalizedRetailSentiment, classifyRetailSentimentFreshness } from "./retail-sentiment";
import { getSymbolMapping } from "./symbol-map";
import {
  getLatestStoredPrice,
  getLatestStoredDailyCandles,
  getLatestStoredCandles,
  getLatestStoredPositioning,
  getLatestStoredRetailSentiment,
  getLatestStoredEconomicSeries,
} from "@/db/queries/market-data";
import { FredSeriesPoint, NormalizedCandle, NormalizedQuote, Provenance, ProviderName, unavailable } from "../types";

// Human-readable label per provider, for the storage-fallback branches
// below — never a hardcoded "Financial Modeling Prep" regardless of which
// provider actually wrote the stored row (see item 7: provenance must
// reflect the TRUE source, e.g. "oanda").
const PROVIDER_LABEL: Record<string, string> = { fmp: "Financial Modeling Prep", oanda: "OANDA v20" };

function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

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
  const live = await marketData.getQuote(symbol);
  if (live.status === "live") return live;

  const stored = await getLatestStoredPrice(symbol);
  if (!stored) return live; // never had data -> surface the live unavailable/error/rate-limited result unchanged

  const freshness = classifyStoredAge(stored.fetchedAt);
  const sourceTimestamp = (stored.sourceUpdatedAt ?? stored.fetchedAt).toISOString();
  return {
    provider: stored.provider as ProviderName,
    source: `${providerLabel(stored.provider)} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(), // the real time we stored this, not now()
    sourceUpdatedAt: sourceTimestamp,
    nextExpectedUpdate: null,
    value: { symbol, price: stored.price, changePct24h: stored.changePct24h, timestamp: sourceTimestamp },
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing last stored value from ${stored.fetchedAt.toISOString()}`,
  };
}

export async function getDailyCandlesWithFallback(symbol: string, days = 260): Promise<Provenance<NormalizedCandle[]>> {
  const live = await marketData.getDailyCandles(symbol, days);
  if (live.status === "live") return live;

  const stored = await getLatestStoredDailyCandles(symbol);
  if (!stored || stored.candles.length === 0) return live;

  const freshness = classifyStoredAge(stored.fetchedAt);
  return {
    provider: stored.provider as ProviderName,
    source: `${providerLabel(stored.provider)} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: stored.candles[stored.candles.length - 1].date,
    nextExpectedUpdate: null,
    value: stored.candles,
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}`,
  };
}

/** Same live-then-storage pattern as getDailyCandlesWithFallback, for 4H/1H
 * candles — the candles cron now writes these to Neon too (see
 * cron/candles/route.ts), so intraday confirmation gets the same
 * last-known-good protection daily candles already had, instead of going
 * unavailable outright whenever a live 4H/1H request fails. */
export async function getIntradayCandlesWithFallback(symbol: string, interval: "1hour" | "4hour"): Promise<Provenance<NormalizedCandle[]>> {
  const live = await marketData.getIntradayCandles(symbol, interval);
  if (live.status === "live") return live;

  const timeframe = interval === "1hour" ? "1h" : "4h";
  const stored = await getLatestStoredCandles(symbol, timeframe);
  if (!stored || stored.candles.length === 0) return live;

  const freshness = classifyStoredAge(stored.fetchedAt);
  return {
    provider: stored.provider as ProviderName,
    source: `${providerLabel(stored.provider)} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: stored.candles[stored.candles.length - 1].date,
    nextExpectedUpdate: null,
    value: stored.candles,
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}`,
  };
}

// CFTC/FRED/retail-sentiment update far less often than a price tick (a
// COT report weekly, most macro indicators monthly-or-slower, sentiment
// snapshots on the cron's own cadence) — a live call that already came back
// "live" or even a real but merely-old "stale"/"delayed" result IS the
// freshest obtainable data, so unlike price/candles above, only a genuine
// fetch failure (unavailable/error — no value at all) should trigger a
// storage read. Falling back to storage on a real "stale" live result would
// be strictly worse: storage can only be at least as old.
function liveFetchFailed<T>(live: Provenance<T>): boolean {
  return live.status === "unavailable" || live.status === "error";
}

export async function getPositioningWithFallback(symbol: string): Promise<Provenance<CftcPositioningResult>> {
  const live = await cftc.getInstitutionalPositioning(symbol);
  if (!liveFetchFailed(live)) return live;

  const stored = await getLatestStoredPositioning(symbol);
  if (!stored) return live; // never had a stored report -> surface the live unavailable/error unchanged

  // "Never use a report beyond the existing freshness limits" — the same
  // ceiling the live path itself enforces (CFTC_STALE_WINDOW_DAYS), applied
  // to the stored report's own reportDate, independent of how recently it
  // was fetched. A report the live path would itself reject as too old
  // must not be resurrected just because it's the newest thing in storage.
  if (!isCftcReportWithinFreshnessLimit(stored.positioning.reportDate)) return live;

  const freshness = classifyStoredAge(stored.fetchedAt);
  return {
    provider: "cftc",
    source: `${live.source} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: stored.positioning.reportDate,
    nextExpectedUpdate: null,
    value: stored.positioning,
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing last stored CFTC report (${stored.positioning.reportDate}), stored ${stored.fetchedAt.toISOString()}`,
  };
}

export async function getFredSeriesWithFallback(country: string, indicator: FredIndicatorKey, limit = 24): Promise<Provenance<FredSeriesPoint[]>> {
  const live = await fred.getSeries(country, indicator, limit);
  if (!liveFetchFailed(live)) return live;

  const stored = await getLatestStoredEconomicSeries(country, indicator, limit);
  if (!stored || stored.points.length === 0) return live; // never had a stored observation -> unchanged

  // Freshness is classified from the observation's own age, exactly like
  // the live path (classifyFredFreshness) — a stored point isn't "less
  // fresh" just because it came from Neon; it's the same real data.
  const latestObservationDate = stored.points[stored.points.length - 1].date;
  const { freshness, ageDays, cadence } = classifyFredFreshness(indicator, latestObservationDate);
  return {
    provider: "fred",
    source: `${live.source} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: latestObservationDate,
    nextExpectedUpdate: null,
    value: stored.points,
    error: `Live refresh unavailable (${live.error ?? live.status}) — showing stored observations, latest dated ${latestObservationDate} (~${ageDays}d old, ${cadence} cadence)`,
  };
}

/** Reads Neon ONLY — never calls a retail-sentiment provider live. See the
 * file-header note above: OANDA (or IG/Myfxbook) is only ever called from
 * the scheduled cron, not from a page render or the scoring engine.
 * Freshness is classified from the observation's own source timestamp, not
 * from when the row was written — see classifyRetailSentimentFreshness. A
 * symbol that has never had a successful provider write stays UNAVAILABLE —
 * never a fabricated stand-in. */
export async function getRetailSentimentFromStorage(symbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  const stored = await getLatestStoredRetailSentiment(symbol);
  if (!stored) {
    // Symbol-aware, not a generic "OANDA/IG/Myfxbook" list that implies all
    // three might apply to every market — most markets only have one or two
    // actually configured (see symbol-map.ts). Naming the real configured
    // provider(s), and explicitly noting when OANDA has been checked and
    // confirmed not to cover this instrument (e.g. metals — OANDA's
    // PositionBook was verified live against XAU_USD/XAG_USD and does not
    // return usable data), keeps this reading as an honest structural gap
    // rather than "just hasn't refreshed yet" when it's actually stuck on
    // the one remaining provider (Myfxbook) never having produced a real
    // observation for this symbol.
    const mapping = getSymbolMapping(symbol);
    const configured: { label: string; provider: ProviderName }[] = [];
    if (mapping?.oandaInstrument) configured.push({ label: "OANDA", provider: "oanda" });
    if (mapping?.igEpic) configured.push({ label: "IG", provider: "ig" });
    if (mapping?.myfxbookSymbol) configured.push({ label: "Myfxbook", provider: "myfxbook" });
    const primaryProvider = configured[0]?.provider ?? "oanda";
    const providerLabel = configured.length > 0 ? configured.map((c) => c.label).join(" / ") : "no provider";
    const oandaNote =
      !mapping?.oandaInstrument && (mapping?.igEpic || mapping?.myfxbookSymbol)
        ? " OANDA's PositionBook has been verified against this instrument and does not provide usable coverage for it, so this factor depends entirely on the remaining configured provider(s) above."
        : "";
    return unavailable(
      primaryProvider,
      configured.length > 0 ? `${providerLabel} retail sentiment` : "Retail Sentiment",
      `No retail-sentiment observation has ever been stored for ${symbol}. Configured provider(s) for this market: ${providerLabel}.${oandaNote} The scheduled ingestion job (cron/retail-sentiment) will populate this once one of them succeeds.`
    );
  }

  // sourceUpdatedAt is the provider's own timestamp for this observation
  // (OANDA PositionBook's `time`); fall back to fetchedAt only for rows
  // written before that column existed, or from a provider that never had
  // a real per-symbol timestamp to offer — storage provenance (fetchedAt)
  // otherwise plays no part in the freshness classification.
  const sourceTimestamp = (stored.sourceUpdatedAt ?? stored.fetchedAt).toISOString();
  const { freshness } = classifyRetailSentimentFreshness(sourceTimestamp);
  return {
    // The DB column is a free varchar, but it's only ever written from a
    // real ProviderName at insert time (see cron/retail-sentiment/route.ts).
    provider: stored.provider as Provenance<NormalizedRetailSentiment>["provider"],
    source: stored.source,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: sourceTimestamp,
    nextExpectedUpdate: null,
    value: { symbol, pctLong: stored.pctLong, pctShort: stored.pctShort },
  };
}
