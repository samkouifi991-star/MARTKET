// GBPUSD dependency-chain validation — distinct from the general Provider
// Health page (which reports aggregate provider status across all 25
// markets). Two modes:
//   - getGbpusdValidationSnapshot(): storage-first, reads only the database
//     and provider-health records — no external provider calls. This is
//     the default view; opening the admin page must never itself trigger a
//     burst of FMP/CFTC/FRED/Myfxbook requests.
//   - getGbpusdValidation(): the original live-calls-every-provider check,
//     now only invoked from the explicit, rate-limited "Run Live
//     Validation" button (see /api/admin/gbpusd-validation/run).
// Both build the same ValidationRow[] shape, tagged REQUIRED/OPTIONAL per
// the Definition of Done (item 12): GBPUSD is "fully live" when every
// REQUIRED row is live, regardless of OPTIONAL gaps (1H/4H confirmation,
// retail sentiment, secondary news) — those degrade confidence, they don't
// block readiness.
import { DataFreshness } from "@/lib/types";
import * as fmp from "@/services/market-data/fmp";
import * as cftc from "@/services/market-data/cftc";
import * as fred from "@/services/market-data/fred";
import { diagnoseMyfxbookConnection, MyfxbookDiagnostic, myfxbookProvider } from "@/services/market-data/retail-sentiment/myfxbook";
import { igProvider } from "@/services/market-data/retail-sentiment/ig-provider";
import { getGbpusdRecordCounts, getGbpusdStorageSnapshot, GbpusdRecordCounts, DatasetSnapshot } from "@/db/queries/gbpusd-validation";
import { getProviderHealth, ProviderHealthRow } from "@/db/queries/provider-health";
import { getScoreHistory } from "@/db/queries/scores";
import { FRED_SERIES, FredIndicatorKey } from "@/services/market-data/fred-series";

const SYMBOL = "GBPUSD";

export type Importance = "required" | "optional";

export type ValidationRow = {
  provider: string;
  dataset: string;
  importance: Importance;
  status: DataFreshness;
  lastFetch: string | null;
  sourceTimestamp: string | null;
  records: number | string;
  factorUsing: string;
  detail?: string;
  nextScheduledRefresh?: string | null;
};

// Dataset keys shared with the cron ingestion routes' recordProviderCheck
// calls (see src/app/api/cron/*) — this is the join key between "what did
// we last try to fetch" (provider_health) and "what do we actually have"
// (the data tables themselves).
const HEALTH_KEYS = {
  quote: "fmp:quote",
  daily: "fmp:daily",
  h4: "fmp:4h",
  h1: "fmp:1h",
  news: "fmp:news",
  positioning: "cftc:positioning",
  retailSentiment: "retail-sentiment",
} as const;

function fredHealthKey(country: string, indicator: string): string {
  return `fred:${country}:${indicator}`;
}

// Mirrors vercel.json's cron schedule (UTC). Not read at runtime — cron
// config isn't introspectable from inside the app — so this must be kept in
// sync by hand if vercel.json changes. All jobs currently run once daily
// (Vercel Hobby plan blocks sub-daily cron schedules entirely, see project
// history) except positioning, which is weekly on CFTC's Saturday publish
// cadence — this is also why the freshness windows below are generous
// rather than matching the aspirational per-item-3 cadences.
const CRON_SCHEDULE: Record<string, { hourUTC: number; dayOfWeekUTC?: number }> = {
  [HEALTH_KEYS.quote]: { hourUTC: 3 },
  [HEALTH_KEYS.daily]: { hourUTC: 1 },
  [HEALTH_KEYS.h4]: { hourUTC: 1 },
  [HEALTH_KEYS.h1]: { hourUTC: 1 },
  [HEALTH_KEYS.positioning]: { hourUTC: 6, dayOfWeekUTC: 6 },
  [HEALTH_KEYS.retailSentiment]: { hourUTC: 4 },
  [HEALTH_KEYS.news]: { hourUTC: 7 },
};

function nextScheduledRefresh(key: string): string | null {
  const sched = CRON_SCHEDULE[key] ?? (key.startsWith("fred:") ? { hourUTC: 2 } : null);
  if (!sched) return null;
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), sched.hourUTC, 0, 0));
  if (sched.dayOfWeekUTC !== undefined) {
    let daysToAdd = (sched.dayOfWeekUTC - next.getUTCDay() + 7) % 7;
    if (daysToAdd === 0 && next.getTime() <= now.getTime()) daysToAdd = 7;
    next.setUTCDate(next.getUTCDate() + daysToAdd);
  } else if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

// Freshness windows for the storage-first snapshot, generous enough to
// match the real (once-daily) cron cadence rather than flagging every row
// "stale" purely because of the Hobby-plan cron limitation.
const MAX_AGE_MS = {
  quote: 30 * 3_600_000,
  daily: 34 * 3_600_000,
  intraday: 34 * 3_600_000,
  positioning: 10 * 86_400_000, // matches cftc.ts's own FRESH_WINDOW_DAYS
  retailSentiment: 30 * 3_600_000,
  news: 30 * 3_600_000,
  // FRED/macro rows use fred.classifyFredFreshness's per-indicator cadence
  // windows directly (see below) instead of a flat age here.
};

function classifyByAge(snapshot: DatasetSnapshot, maxAgeMs: number): DataFreshness {
  if (snapshot.count === 0) return "unavailable";
  const reference = snapshot.latestSourceDate ?? snapshot.lastFetchedAt;
  if (!reference) return "unavailable";
  const ageMs = Date.now() - new Date(reference).getTime();
  return ageMs <= maxAgeMs ? "live" : "stale";
}

function detailFor(snapshot: DatasetSnapshot, health: ProviderHealthRow | undefined): string | undefined {
  if (snapshot.count > 0) {
    // We have real data; a failed *latest* refresh attempt doesn't erase it
    // — surfaced as context, not as an ERROR (the row is already "stale",
    // not "error", precisely because present-but-old data is not a failure).
    return health?.status === "error" && health.lastError ? `Latest scheduled refresh failed (showing last known-good data): ${health.lastError}` : undefined;
  }
  return health?.lastError ?? "No data in storage yet — awaiting first scheduled ingestion";
}

function storageRow(
  provider: string,
  dataset: string,
  importance: Importance,
  factorUsing: string,
  snapshot: DatasetSnapshot,
  maxAgeMs: number,
  healthKey: string,
  healthByKey: Map<string, ProviderHealthRow>
): ValidationRow {
  const health = healthByKey.get(healthKey);
  return {
    provider,
    dataset,
    importance,
    status: classifyByAge(snapshot, maxAgeMs),
    lastFetch: snapshot.lastFetchedAt,
    sourceTimestamp: snapshot.latestSourceDate,
    records: snapshot.count,
    factorUsing,
    detail: detailFor(snapshot, health),
    nextScheduledRefresh: nextScheduledRefresh(healthKey),
  };
}

export type GbpusdValidationResult = {
  rows: ValidationRow[];
  dbCounts: GbpusdRecordCounts | null;
  dbError: string | null;
  myfxbookDiagnostic: MyfxbookDiagnostic | null;
  generatedAt: string;
  mode: "storage" | "live";
};

/** Default view: reads the database and provider-health table only. Opening
 * this never calls FMP/CFTC/FRED/Myfxbook — the fix for the 429 storm that
 * came from this page independently re-fetching everything on every render. */
export async function getGbpusdValidationSnapshot(): Promise<GbpusdValidationResult> {
  const now = new Date().toISOString();

  let snapshot: Awaited<ReturnType<typeof getGbpusdStorageSnapshot>> | null = null;
  let dbCounts: GbpusdRecordCounts | null = null;
  let dbError: string | null = null;
  let healthRows: ProviderHealthRow[] = [];
  try {
    [snapshot, dbCounts, healthRows] = await Promise.all([getGbpusdStorageSnapshot(), getGbpusdRecordCounts(), getProviderHealth()]);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  if (!snapshot || !dbCounts) {
    return { rows: [], dbCounts: null, dbError, myfxbookDiagnostic: null, generatedAt: now, mode: "storage" };
  }

  const healthByKey = new Map(healthRows.map((r) => [r.provider, r]));
  const s = snapshot;

  const rows: ValidationRow[] = [
    storageRow("FMP", "Quotes (GBPUSD)", "required", "Price, Technical Trend", s.price ?? { count: 0, lastFetchedAt: null, latestSourceDate: null }, MAX_AGE_MS.quote, HEALTH_KEYS.quote, healthByKey),
    storageRow("FMP", "Daily candles (GBPUSD)", "required", "Technical Trend, Seasonality, Price chart", s.candlesDaily, MAX_AGE_MS.daily, HEALTH_KEYS.daily, healthByKey),
    storageRow("FMP", "4H candles (GBPUSD)", "optional", "Technical Trend (intraday confirmation)", s.candles4h, MAX_AGE_MS.intraday, HEALTH_KEYS.h4, healthByKey),
    storageRow("FMP", "1H candles (GBPUSD)", "optional", "Technical Trend (intraday confirmation)", s.candles1h, MAX_AGE_MS.intraday, HEALTH_KEYS.h1, healthByKey),
    storageRow("FMP", "Forex/market news", "optional", "News", s.news, MAX_AGE_MS.news, HEALTH_KEYS.news, healthByKey),
    storageRow("CFTC", "GBP futures positioning (Asset Manager)", "required", "Institutional Positioning, Smart Money", s.positioning, MAX_AGE_MS.positioning, HEALTH_KEYS.positioning, healthByKey),
    storageRow("Myfxbook", "GBPUSD Community Outlook", "optional", "Retail Sentiment (primary)", s.retailSentiment, MAX_AGE_MS.retailSentiment, HEALTH_KEYS.retailSentiment, healthByKey),
  ];

  for (const [country, indicatorKey] of GBPUSD_FRED_INDICATORS) {
    const meta = FRED_SERIES[country]?.[indicatorKey];
    const key = `${country}:${indicatorKey}`;
    const indicatorSnapshot = s.economicIndicators[key] ?? { count: 0, lastFetchedAt: null, latestSourceDate: null };
    const label = FRED_FACTOR_LABEL[indicatorKey] ?? indicatorKey;
    const dataset = `${country} ${FRED_DATASET_LABEL[indicatorKey] ?? indicatorKey}`;
    const health = healthByKey.get(fredHealthKey(country, indicatorKey));

    if (!meta?.verified) {
      rows.push({
        provider: "FRED",
        dataset,
        importance: "required",
        status: "unavailable",
        lastFetch: null,
        sourceTimestamp: null,
        records: 0,
        factorUsing: label,
        detail: meta
          ? `Series ${meta.id} not yet verified against the real FRED API — see npm run test:fred-verify. Unverified series never contribute to the score.`
          : `No FRED series mapped for ${country} ${indicatorKey}.`,
        nextScheduledRefresh: null,
      });
      continue;
    }

    // API availability and data freshness are separate concepts (see
    // fred.ts's classifyFredFreshness, same rule used by the live path) —
    // per-indicator cadence, not the flat MAX_AGE_MS.macro window, so a
    // technically-resolvable-but-months-old series (e.g. GB CPI) reads as
    // stale/delayed here too, consistently with the live score.
    const status: DataFreshness =
      indicatorSnapshot.count === 0 || !indicatorSnapshot.latestSourceDate
        ? "unavailable"
        : fred.classifyFredFreshness(indicatorKey, indicatorSnapshot.latestSourceDate).freshness;
    rows.push({
      provider: "FRED",
      dataset,
      importance: "required",
      status,
      lastFetch: indicatorSnapshot.lastFetchedAt,
      sourceTimestamp: indicatorSnapshot.latestSourceDate,
      records: indicatorSnapshot.count,
      factorUsing: label,
      detail: detailFor(indicatorSnapshot, health),
      nextScheduledRefresh: nextScheduledRefresh(fredHealthKey(country, indicatorKey)),
    });
  }

  // IG — optional secondary retail-sentiment provider, no dedicated storage
  // table row of its own (folded into retail_sentiment with provider="ig");
  // reported from provider health only.
  const igHealth = healthByKey.get("retail-sentiment");
  rows.push({
    provider: "IG",
    dataset: "GBPUSD Client Sentiment",
    importance: "optional",
    status: s.retailSentiment.count > 0 ? classifyByAge(s.retailSentiment, MAX_AGE_MS.retailSentiment) : "unavailable",
    lastFetch: igHealth?.lastSuccessAt ?? null,
    sourceTimestamp: null,
    records: "—",
    factorUsing: "Retail Sentiment (secondary, optional)",
    detail: "Shares the retail_sentiment table with Myfxbook — see the primary row above for the concrete last-fetch evidence.",
  });

  // Engine rows: Technical Trend and Seasonality have no independent data
  // source beyond daily candles (confirmed in lib/pipeline/technical.ts and
  // seasonality.ts, both driven entirely by fmp.getDailyCandles), so their
  // status mirrors the daily-candles row rather than re-deriving it.
  const dailyRow = rows[1];
  rows.push({
    provider: "Engine",
    dataset: "Technical Trend (daily-only capable per item 7)",
    importance: "required",
    status: dailyRow.status,
    lastFetch: dailyRow.lastFetch,
    sourceTimestamp: dailyRow.sourceTimestamp,
    records: dailyRow.records,
    factorUsing: "Technical Trend",
    detail: dailyRow.status === "unavailable" ? "Blocked: no daily candle data in storage yet." : "Computes from daily candles; 4H/1H are confirmation-only, not required.",
  });
  rows.push({
    provider: "Engine",
    dataset: "Seasonality",
    importance: "required",
    status: dailyRow.status,
    lastFetch: dailyRow.lastFetch,
    sourceTimestamp: dailyRow.sourceTimestamp,
    records: dailyRow.records,
    factorUsing: "Seasonality",
    detail: dailyRow.status === "unavailable" ? "Blocked: no daily candle data in storage yet." : undefined,
  });

  let scoreDetail: string | undefined;
  let scoreRow: ValidationRow;
  try {
    const history = await getScoreHistory(SYMBOL, 24 * 14);
    const latest = history[0] ?? null;
    scoreRow = {
      provider: "Engine",
      dataset: "GBPUSD total score (weighted)",
      importance: "required",
      status: latest ? classifyByAge({ count: 1, lastFetchedAt: latest.computedAt, latestSourceDate: latest.computedAt }, MAX_AGE_MS.daily) : "unavailable",
      lastFetch: latest?.computedAt ?? null,
      sourceTimestamp: latest?.computedAt ?? null,
      records: history.length,
      factorUsing: "Final score engine",
      detail: latest ? `Score ${latest.totalScore.toFixed(1)} (${latest.bias}), confidence ${latest.confidence}%` : "No score computed and stored yet.",
    };
  } catch (err) {
    scoreDetail = err instanceof Error ? err.message : String(err);
    scoreRow = {
      provider: "Engine",
      dataset: "GBPUSD total score (weighted)",
      importance: "required",
      status: "error",
      lastFetch: null,
      sourceTimestamp: null,
      records: 0,
      factorUsing: "Final score engine",
      detail: scoreDetail,
    };
  }
  rows.push(scoreRow);

  return { rows, dbCounts, dbError, myfxbookDiagnostic: null, generatedAt: now, mode: "storage" };
}

// The curated set of FRED indicators GBPUSD's macro factors actually read
// for this validation page — deliberately narrower than every key in
// fred-series.ts (which also carries indicators for EU/JP/CA/AU/NZ/CH and a
// few US-only extras like yield curves not used by GBPUSD's factors), so
// this table matches what item 9 asked to verify: US core macro plus UK
// inflation, labor, GDP, and interest-rate series.
const GBPUSD_FRED_INDICATORS: [string, FredIndicatorKey][] = [
  ["US", "cpi"],
  ["US", "coreCpi"],
  ["US", "gdpGrowth"],
  ["US", "unemploymentRate"],
  ["US", "payrolls"],
  ["US", "policyRate"],
  ["GB", "cpi"],
  ["GB", "unemploymentRate"],
  ["GB", "policyRate"],
  ["GB", "gdpGrowth"],
];

const FRED_DATASET_LABEL: Partial<Record<FredIndicatorKey, string>> = {
  cpi: "CPI",
  coreCpi: "Core CPI",
  gdpGrowth: "GDP growth",
  unemploymentRate: "unemployment rate",
  payrolls: "payrolls",
  policyRate: "policy rate",
};

const FRED_FACTOR_LABEL: Partial<Record<FredIndicatorKey, string>> = {
  cpi: "Inflation",
  coreCpi: "Inflation",
  gdpGrowth: "Economic Growth",
  unemploymentRate: "Labor Market",
  payrolls: "Labor Market",
  policyRate: "Interest Rates",
};

type Fetched = { status: DataFreshness; fetchedAt: string; sourceUpdatedAt: string | null; error?: string };

function toRow(provider: string, dataset: string, importance: Importance, p: Fetched, records: number | string, factorUsing: string): ValidationRow {
  return { provider, dataset, importance, status: p.status, lastFetch: p.fetchedAt, sourceTimestamp: p.sourceUpdatedAt, records, factorUsing, detail: p.error };
}

/** Live mode — only reachable from the explicit "Run Live Validation"
 * button (see /api/admin/gbpusd-validation/run), which wraps this in
 * request-cache coalescing so rapid clicks collapse into one in-flight
 * run rather than each independently hammering every provider. */
export async function getGbpusdValidation(): Promise<GbpusdValidationResult> {
  const [
    quote,
    daily,
    h4,
    h1,
    news,
    positioning,
    usCpi,
    usCoreCpi,
    usGdpGrowth,
    usUnemployment,
    usPayrolls,
    usPolicyRate,
    gbCpi,
    gbUnemployment,
    gbPolicyRate,
    gbGdpGrowth,
    myfxbook,
    ig,
    myfxbookDiagnostic,
  ] = await Promise.all([
    fmp.getQuote(SYMBOL),
    fmp.getDailyCandles(SYMBOL),
    fmp.getIntradayCandles(SYMBOL, "4hour"),
    fmp.getIntradayCandles(SYMBOL, "1hour"),
    fmp.getForexAndMarketNews(50),
    cftc.getInstitutionalPositioning(SYMBOL),
    fred.getSeries("US", "cpi"),
    fred.getSeries("US", "coreCpi"),
    fred.getSeries("US", "gdpGrowth"),
    fred.getSeries("US", "unemploymentRate"),
    fred.getSeries("US", "payrolls"),
    fred.getSeries("US", "policyRate"),
    fred.getSeries("GB", "cpi"),
    fred.getSeries("GB", "unemploymentRate"),
    fred.getSeries("GB", "policyRate"),
    fred.getSeries("GB", "gdpGrowth"),
    myfxbookProvider.getRetailSentiment(SYMBOL),
    igProvider.getRetailSentiment(SYMBOL),
    diagnoseMyfxbookConnection(SYMBOL),
  ]);

  let dbCounts: GbpusdRecordCounts | null = null;
  let dbError: string | null = null;
  try {
    dbCounts = await getGbpusdRecordCounts();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  const r = (n: number | undefined) => (dbCounts ? (n ?? 0) : dbError ? "error" : "—");

  const rows: ValidationRow[] = [
    toRow("FMP", "Quotes (GBPUSD)", "required", quote, r(dbCounts?.marketPrices), "Price, Technical Trend"),
    toRow("FMP", "Daily candles (GBPUSD)", "required", daily, r(dbCounts?.marketCandlesDaily), "Technical Trend, Seasonality, Price chart"),
    toRow("FMP", "4H candles (GBPUSD)", "optional", h4, r(dbCounts?.marketCandles4h), "Technical Trend (intraday confirmation)"),
    toRow("FMP", "1H candles (GBPUSD)", "optional", h1, r(dbCounts?.marketCandles1h), "Technical Trend (intraday confirmation)"),
    toRow("FMP", "Forex/market news", "optional", news, "—", "News"),
    toRow("CFTC", "GBP futures positioning (Asset Manager)", "required", positioning, r(dbCounts?.institutionalPositioning), "Institutional Positioning, Smart Money"),
    toRow("FRED", "US CPI", "required", usCpi, r(dbCounts?.economicIndicatorsUS), "Inflation"),
    toRow("FRED", "US Core CPI", "required", usCoreCpi, r(dbCounts?.economicIndicatorsUS), "Inflation"),
    toRow("FRED", "US GDP growth", "required", usGdpGrowth, r(dbCounts?.economicIndicatorsUS), "Economic Growth"),
    toRow("FRED", "US unemployment rate", "required", usUnemployment, r(dbCounts?.economicIndicatorsUS), "Labor Market"),
    toRow("FRED", "US payrolls", "required", usPayrolls, r(dbCounts?.economicIndicatorsUS), "Labor Market"),
    toRow("FRED", "US policy rate (Fed Funds)", "required", usPolicyRate, r(dbCounts?.economicIndicatorsUS), "Interest Rates"),
    toRow("FRED", "GB CPI", "required", gbCpi, r(dbCounts?.economicIndicatorsGB), "Inflation"),
    toRow("FRED", "GB unemployment rate", "required", gbUnemployment, r(dbCounts?.economicIndicatorsGB), "Labor Market"),
    toRow("FRED", "GB policy rate (Bank Rate / SONIA)", "required", gbPolicyRate, r(dbCounts?.economicIndicatorsGB), "Interest Rates"),
    toRow("FRED", "GB GDP growth", "required", gbGdpGrowth, r(dbCounts?.economicIndicatorsGB), "Economic Growth"),
    toRow("Myfxbook", "GBPUSD Community Outlook", "optional", myfxbook, r(dbCounts?.retailSentiment), "Retail Sentiment (primary)"),
    toRow("IG", "GBPUSD Client Sentiment", "optional", ig, "—", "Retail Sentiment (secondary, optional)"),
  ];

  // Technical Trend / Seasonality mirror the live daily-candles result —
  // same reasoning as the storage-first snapshot above: neither has an
  // independent data source.
  rows.push({
    provider: "Engine",
    dataset: "Technical Trend (daily-only capable per item 7)",
    importance: "required",
    status: daily.status,
    lastFetch: daily.fetchedAt,
    sourceTimestamp: daily.sourceUpdatedAt,
    records: r(dbCounts?.marketCandlesDaily),
    factorUsing: "Technical Trend",
    detail: daily.status !== "live" ? daily.error : "Computes from daily candles; 4H/1H are confirmation-only, not required.",
  });
  rows.push({
    provider: "Engine",
    dataset: "Seasonality",
    importance: "required",
    status: daily.status,
    lastFetch: daily.fetchedAt,
    sourceTimestamp: daily.sourceUpdatedAt,
    records: r(dbCounts?.marketCandlesDaily),
    factorUsing: "Seasonality",
    detail: daily.status !== "live" ? daily.error : undefined,
  });

  let scoreRow: ValidationRow;
  try {
    const history = await getScoreHistory(SYMBOL, 24 * 14);
    const latest = history[0] ?? null;
    scoreRow = {
      provider: "Engine",
      dataset: "GBPUSD total score (weighted)",
      importance: "required",
      status: latest ? "live" : "unavailable",
      lastFetch: latest?.computedAt ?? null,
      sourceTimestamp: latest?.computedAt ?? null,
      records: history.length,
      factorUsing: "Final score engine",
      detail: latest ? `Score ${latest.totalScore.toFixed(1)} (${latest.bias}), confidence ${latest.confidence}%` : "No score computed and stored yet.",
    };
  } catch (err) {
    scoreRow = {
      provider: "Engine",
      dataset: "GBPUSD total score (weighted)",
      importance: "required",
      status: "error",
      lastFetch: null,
      sourceTimestamp: null,
      records: 0,
      factorUsing: "Final score engine",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  rows.push(scoreRow);

  return { rows, dbCounts, dbError, myfxbookDiagnostic, generatedAt: new Date().toISOString(), mode: "live" };
}

export type ValidationSummary = {
  total: number;
  live: number;
  degraded: number;
  unavailable: number;
  error: number;
  requiredTotal: number;
  requiredLive: number;
  optionalTotal: number;
  optionalLive: number;
  allRequiredLive: boolean;
};

/** The Definition of Done gate: GBPUSD counts as "fully live" only when
 * every REQUIRED row is live — an OPTIONAL gap (1H/4H confirmation, retail
 * sentiment, secondary news) reduces confidence elsewhere but never blocks
 * this. Matches item 12 exactly: "Do not make 'GBPUSD fully live' require
 * an optional dataset that our subscribed provider legitimately does not
 * offer." */
export function summarizeValidation(rows: ValidationRow[]): ValidationSummary {
  const live = rows.filter((r) => r.status === "live").length;
  const degraded = rows.filter((r) => r.status === "stale" || r.status === "delayed").length;
  const unavailable = rows.filter((r) => r.status === "unavailable").length;
  const error = rows.filter((r) => r.status === "error").length;
  const required = rows.filter((r) => r.importance === "required");
  const optional = rows.filter((r) => r.importance === "optional");
  const requiredLive = required.filter((r) => r.status === "live").length;
  const optionalLive = optional.filter((r) => r.status === "live").length;
  return {
    total: rows.length,
    live,
    degraded,
    unavailable,
    error,
    requiredTotal: required.length,
    requiredLive,
    optionalTotal: optional.length,
    optionalLive,
    allRequiredLive: required.length > 0 && requiredLive === required.length,
  };
}
