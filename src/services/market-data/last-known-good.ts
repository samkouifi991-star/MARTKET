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
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import {
  getLatestStoredPrice,
  getLatestStoredDailyCandles,
  getLatestStoredCandles,
  getLatestStoredPositioning,
  getLatestStoredRetailSentiment,
  getLatestStoredEconomicSeries,
  getLatestStoredEconomicSeriesForCountries,
  StoredEconomicSeries,
  StoredPrice,
  StoredDailyCandles,
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

function quoteFromStored(symbol: string, stored: StoredPrice, note: string): Provenance<NormalizedQuote> {
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
    error: note,
  };
}

/** `storageOnly` (default false) skips the live provider call entirely and
 * reads Neon directly — for callers (Top Setups) that must never trigger a
 * live provider fetch, only read whatever the scheduled ingestion cron has
 * already stored. Every existing call site keeps its current live-first
 * behavior unchanged since this defaults to false. */
export async function getQuoteWithFallback(symbol: string, storageOnly = false): Promise<Provenance<NormalizedQuote>> {
  if (storageOnly) {
    const stored = await getLatestStoredPrice(symbol);
    if (!stored) return unavailable("fmp", "Financial Modeling Prep", `No stored price exists yet for ${symbol} (storage-only read — no live provider call attempted).`);
    return quoteFromStored(symbol, stored, `Storage-only read — showing last stored value from ${stored.fetchedAt.toISOString()}.`);
  }

  const live = await marketData.getQuote(symbol);
  if (live.status === "live") return live;

  const stored = await getLatestStoredPrice(symbol);
  if (!stored) return live; // never had data -> surface the live unavailable/error/rate-limited result unchanged

  return quoteFromStored(symbol, stored, `Live refresh unavailable (${live.error ?? live.status}) — showing last stored value from ${stored.fetchedAt.toISOString()}`);
}

function candlesFromStored(stored: StoredDailyCandles, note: string): Provenance<NormalizedCandle[]> {
  const freshness = classifyStoredAge(stored.fetchedAt);
  return {
    provider: stored.provider as ProviderName,
    source: `${providerLabel(stored.provider)} (last known good — stored)`,
    status: freshness,
    fetchedAt: stored.fetchedAt.toISOString(),
    sourceUpdatedAt: stored.candles[stored.candles.length - 1].date,
    nextExpectedUpdate: null,
    value: stored.candles,
    error: note,
  };
}

export async function getDailyCandlesWithFallback(symbol: string, days = 260, storageOnly = false): Promise<Provenance<NormalizedCandle[]>> {
  if (storageOnly) {
    const stored = await getLatestStoredDailyCandles(symbol, days);
    if (!stored || stored.candles.length === 0) return unavailable("fmp", "Financial Modeling Prep", `No stored daily candles exist yet for ${symbol} (storage-only read — no live provider call attempted).`);
    return candlesFromStored(stored, `Storage-only read — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}.`);
  }

  const live = await marketData.getDailyCandles(symbol, days);
  if (live.status === "live") return live;

  const stored = await getLatestStoredDailyCandles(symbol, days);
  if (!stored || stored.candles.length === 0) return live;

  return candlesFromStored(stored, `Live refresh unavailable (${live.error ?? live.status}) — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}`);
}

/** Same live-then-storage pattern as getDailyCandlesWithFallback, for 4H/1H
 * candles — the candles cron now writes these to Neon too (see
 * cron/candles/route.ts), so intraday confirmation gets the same
 * last-known-good protection daily candles already had, instead of going
 * unavailable outright whenever a live 4H/1H request fails. `storageOnly`
 * follows the same rule as getQuoteWithFallback above. */
export async function getIntradayCandlesWithFallback(symbol: string, interval: "1hour" | "4hour", storageOnly = false): Promise<Provenance<NormalizedCandle[]>> {
  const timeframe = interval === "1hour" ? "1h" : "4h";

  if (storageOnly) {
    const stored = await getLatestStoredCandles(symbol, timeframe);
    if (!stored || stored.candles.length === 0) return unavailable("fmp", "Financial Modeling Prep", `No stored ${interval} candles exist yet for ${symbol} (storage-only read — no live provider call attempted).`);
    return candlesFromStored(stored, `Storage-only read — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}.`);
  }

  const live = await marketData.getIntradayCandles(symbol, interval);
  if (live.status === "live") return live;

  const stored = await getLatestStoredCandles(symbol, timeframe);
  if (!stored || stored.candles.length === 0) return live;

  return candlesFromStored(stored, `Live refresh unavailable (${live.error ?? live.status}) — showing ${stored.candles.length} stored candles, last written ${stored.fetchedAt.toISOString()}`);
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

const CFTC_SOURCE = "CFTC Commitments of Traders";

export async function getPositioningWithFallback(symbol: string, storageOnly = false): Promise<Provenance<CftcPositioningResult>> {
  if (storageOnly) {
    const stored = await getLatestStoredPositioning(symbol);
    if (!stored || !isCftcReportWithinFreshnessLimit(stored.positioning.reportDate)) {
      return unavailable("cftc", CFTC_SOURCE, `No usable stored CFTC report exists for ${symbol} (storage-only read — no live provider call attempted).`);
    }
    const freshness = classifyStoredAge(stored.fetchedAt);
    return {
      provider: "cftc",
      source: `${CFTC_SOURCE} (last known good — stored)`,
      status: freshness,
      fetchedAt: stored.fetchedAt.toISOString(),
      sourceUpdatedAt: stored.positioning.reportDate,
      nextExpectedUpdate: null,
      value: stored.positioning,
      error: `Storage-only read — showing last stored CFTC report (${stored.positioning.reportDate}), stored ${stored.fetchedAt.toISOString()}.`,
    };
  }

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

const FRED_SOURCE = "FRED (Federal Reserve Economic Data)";

// Cross-request cache for the FRED "Macro State" fallback storage read
// (economic_indicators) — added after production observation showed this
// exact query shape at 567,068 calls in ~46h, dwarfing every other query
// bucket combined. Deliberately narrow: this only wraps the STORAGE read
// behind the `storageOnly` branch below — every real economic calendar
// release (economic_events, live/manual/Zapier) is untouched, and the LIVE
// fred.getSeries() branch a few lines down (used by V1/V2 scoring's
// live-first resolution) is also untouched, so this can never make a newly
// entered release, nor a live scoring read, sit behind a stale cache.
//
// Two things were tried and rejected before this design, both confirmed
// against real production traffic (not just reasoned about):
//
// 1. unstable_cache (the pattern market-detail.ts's cachedSeasonalityCandles/
//    cachedPositioning already use) is a no-op here: Next.js 16's own
//    implementation (node_modules/next/dist/server/web/spec-extension/
//    unstable-cache.js) unconditionally SKIPS the cache READ whenever the
//    calling route sets `workStore.fetchCache === "force-no-store"`, which
//    is exactly what `export const dynamic = "force-dynamic"` implies (see
//    caching-without-cache-components.md) — and both the diagnostics
//    verification route and the real production /markets/[symbol] page set
//    that (required for AutoRefresh). Confirmed: two back-to-back requests
//    for the identical symbol each produced a full, undiminished set of
//    fresh reads.
// 2. A plain per-key in-process Map (no batching) reduced calls only
//    inconsistently: Vercel does not guarantee that separate HTTP requests,
//    even seconds apart from the same client, land on the same warm
//    function instance, so a per-request cache miss still issued one query
//    PER IN-RENDER (country, indicator) COMBINATION. A controlled 20-request
//    burst against 4 FX pairs (which together touch multiple economies, and
//    each also pulls Economic Strength data for all 8 tracked currencies)
//    showed no measurable improvement over the pre-fix baseline.
//
// The fix that actually moves the needle is reducing how many queries a
// single cold cache miss costs, not just how often misses happen: this
// batches a miss for ANY (country, indicator, limit) into ONE query
// covering every tracked currency's country for that indicator (mirroring
// getLatestEconomicEventsByIndicators' batching of economic_events), then
// serves every other tracked country's entry for that indicator from the
// same query. Economic Strength/Heatmap computing all 8 currencies'
// indicators — previously 8 separate queries — now costs exactly one, even
// on a cold instance with nothing yet cached. The in-process TTL layer
// on top (30 minutes, far shorter than FRED's own fastest update cadence)
// still helps whenever an instance does stay warm across requests, but the
// batching is what guarantees a real reduction regardless of instance
// reuse. A request for MORE history than is currently cached for that
// (country, indicator) pair (e.g. a 24-point Macro State read is cached,
// then a 60-point regime read for the same indicator arrives) is treated
// as a miss and re-batched at the larger limit, since a smaller cached
// slice can't safely be padded — but every requested limit still costs at
// most one batched query, never one query per country.
const FRED_MACRO_STATE_CACHE_TTL_MS = 30 * 60 * 1000;

// The exact 8 currencies' countries this pipeline tracks FRED data for
// (CCY_TO_COUNTRY's own key set) — batching is scoped to these, matching
// every real caller (macro.ts, economic-strength.ts, economic-heatmap.ts,
// scorecard.ts) which only ever derives a country from one of these 8
// currencies. A country outside this set (should never happen in practice)
// simply won't appear in the batch result, which resolveMacroStateRow's
// existing "no stored series" honest-unavailable handling already covers.
const FRED_TRACKED_COUNTRIES = Array.from(new Set(Object.values(CCY_TO_COUNTRY)));

type FredCountryCacheEntry = { value: StoredEconomicSeries | null; cachedLimit: number; expiresAt: number };
const fredCountryCache = new Map<string, FredCountryCacheEntry>();
const fredPendingBatches = new Map<string, Promise<Map<string, StoredEconomicSeries>>>();

/** Test-only: clears the module-scoped FRED cache so one test's mocked
 * storage response can't leak into another's via a shared cache key. Never
 * called from production code — the whole point of this cache is that it
 * persists for the life of the (warm) process. */
export function __resetFredMacroStateCacheForTests(): void {
  fredCountryCache.clear();
  fredPendingBatches.clear();
}

async function getCachedStoredEconomicSeries(country: string, indicator: FredIndicatorKey, limit: number): Promise<StoredEconomicSeries | null> {
  const now = Date.now();
  const countryKey = `${country}:${indicator}`;
  const cached = fredCountryCache.get(countryKey);
  if (cached && cached.expiresAt > now && cached.cachedLimit >= limit) {
    return cached.value ? { points: cached.value.points.slice(-limit), fetchedAt: cached.value.fetchedAt } : null;
  }

  // Concurrent requests for the same (indicator, limit) across DIFFERENT
  // countries — e.g. Economic Strength's Promise.all over all 8 currencies
  // — share one in-flight batched query instead of each starting their own.
  const batchKey = `${indicator}:${limit}`;
  let batch = fredPendingBatches.get(batchKey);
  if (!batch) {
    batch = getLatestStoredEconomicSeriesForCountries(FRED_TRACKED_COUNTRIES, indicator, limit);
    fredPendingBatches.set(batchKey, batch);
    batch
      .then((byCountry) => {
        const expiresAt = Date.now() + FRED_MACRO_STATE_CACHE_TTL_MS;
        for (const c of FRED_TRACKED_COUNTRIES) {
          fredCountryCache.set(`${c}:${indicator}`, { value: byCountry.get(c) ?? null, cachedLimit: limit, expiresAt });
        }
      })
      .catch(() => {
        // A failed batch caches nothing — the next call retries the DB
        // instead of "remembering" a failure for the full TTL.
      })
      .finally(() => fredPendingBatches.delete(batchKey));
  }

  const byCountry = await batch;
  return byCountry.get(country) ?? null;
}

export async function getFredSeriesWithFallback(country: string, indicator: FredIndicatorKey, limit = 24, storageOnly = false): Promise<Provenance<FredSeriesPoint[]>> {
  if (storageOnly) {
    const stored = await getCachedStoredEconomicSeries(country, indicator, limit);
    if (!stored || stored.points.length === 0) {
      return unavailable("fred", FRED_SOURCE, `No stored ${country}/${indicator} series exists yet (storage-only read — no live provider call attempted).`);
    }
    const latestObservationDate = stored.points[stored.points.length - 1].date;
    const { freshness, ageDays, cadence } = classifyFredFreshness(indicator, latestObservationDate);
    return {
      provider: "fred",
      source: `${FRED_SOURCE} (last known good — stored)`,
      status: freshness,
      fetchedAt: stored.fetchedAt.toISOString(),
      sourceUpdatedAt: latestObservationDate,
      nextExpectedUpdate: null,
      value: stored.points,
      error: `Storage-only read — showing stored observations, latest dated ${latestObservationDate} (~${ageDays}d old, ${cadence} cadence).`,
    };
  }

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
    // The public market score sheet must explain the DATA STATE, not expose
    // which specific provider is configured or why it's failing (e.g. a
    // Myfxbook credential/session error) — that's an implementation detail,
    // not something a normal user needs. That detail is still fully
    // available, just not here: the retail-sentiment cron records every
    // failure (including the real provider error string) per job via
    // recordProviderCheck (see cron/retail-sentiment/route.ts and
    // cron/_shared.ts's runJobForEachSymbol), which is what the Admin
    // Provider Health page reads. This keeps the two audiences correctly
    // separated without duplicating the detail here.
    //
    // This is deliberately the same message regardless of *why* nothing is
    // stored (no provider covers this market at all, or a configured one
    // has never succeeded) — e.g. for XAUUSD/XAGUSD specifically: OANDA's
    // PositionBook was verified live against XAU_USD/XAG_USD and confirmed
    // to return no usable coverage for either with this integration (see
    // scripts/oanda-metals-retail-sentiment-verify.ts), and Myfxbook (the
    // only remaining configured provider for metals) has never produced a
    // stored observation for them. No usable OANDA PositionBook coverage
    // has been verified for this market with the current integration —
    // that's a fact about our verified integration state, not a blanket
    // claim that "OANDA doesn't support metals" as a product.
    return unavailable("oanda", "Retail Sentiment", "No verified retail-positioning source is currently available for this market.");
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
