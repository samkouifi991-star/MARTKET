// Display-oriented data assembly for the grouped market scorecard
// (components/market/Scorecard.tsx) — the same "External API -> raw
// storage -> normalization -> UI" layering market-detail.ts already
// follows, and it composes with market-detail.ts's output rather than
// duplicating it: buildScorecardData takes the MarketScore and
// LiveMarketDetail the page already computed and adds only what those two
// don't already cover (per-indicator calendar rows, the Interest Rates
// section, the V2 shadow Economic Surprise Index). No scoring math, no
// weights, no new writes — every value here is either a direct read of an
// already-computed factor/card, or a fresh storage-first read, never a
// fabricated number. Nothing in this file is called from demo mode.
import { DataFreshness, Instrument, MarketScore, ScoreFactor, ScoreFactorKey } from "@/lib/types";
import { FactorSentiment, factorSentiment } from "@/lib/format";
import { CCY_TO_COUNTRY, factorLabel } from "@/lib/scoring";
import { EconomicIndicatorKey } from "@/services/economic-calendar/indicator-taxonomy";
import { getLatestEconomicEventsByIndicators, StoredEconomicEventRow } from "@/db/queries/market-data";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { scoreIndicator, Trend } from "@/lib/engines/macro-differential";
import { classifyIndicatorSurprise, classifyMacroTrend, IndicatorClassification, MacroTrendKind } from "./indicator-classification";
import { computeGoldMacroRegime, GOLD_SYMBOL, GoldMacroDriver } from "./gold-macro";
import { InstitutionalCardData, LiveMarketDetail } from "./market-detail";
import { CardResult, worseOf } from "./types";
import { buildForexScorecard, ForexScorecardData } from "./forex-scorecard";
import { getLiveNewsFeed } from "./news-feed";
import { getUpcomingHighImpactEvents, StoredCalendarEvent } from "@/db/queries/market-data";
import { ClientNewsArticle } from "@/lib/types";

// ---- Left-panel sub-scores ----
// OUR OWN grouping (not the screenshot's proprietary one), computed purely
// from the already-real, already-summed factor contributions — no I/O, no
// new math. Guaranteed to sum to score.totalScore since the three groups
// partition all 9 SCORE_FACTOR_KEYS exactly once (asserted by
// scorecard.test.ts).
export type ScorecardSubScores = {
  technical: number;
  sentimentPositioning: number;
  fundamentals: number;
};

function contributionOf(factors: ScoreFactor[], key: ScoreFactorKey): number {
  return factors.find((f) => f.key === key)?.contribution ?? 0;
}

function computeSubScores(factors: ScoreFactor[]): ScorecardSubScores {
  return {
    technical: contributionOf(factors, "technical") + contributionOf(factors, "seasonality"),
    sentimentPositioning: contributionOf(factors, "institutional") + contributionOf(factors, "retailSentiment"),
    fundamentals: contributionOf(factors, "economicGrowth") + contributionOf(factors, "inflation") + contributionOf(factors, "labor") + contributionOf(factors, "interestRates") + contributionOf(factors, "news"),
  };
}

// ---- "Why this score?" driver attribution (Phase 7) ----
// Purely a re-sort/re-label of the SAME score.factors contributions already
// shown elsewhere on the scorecard — no LLM text, no new numbers, no I/O.
// A factor with an exactly-zero contribution isn't driving the score in
// either direction, so it's excluded rather than padding the list.
export type ScoreDriverRow = { key: ScoreFactorKey; label: string; contribution: number; explanation: string; freshness: DataFreshness };

const MAX_DRIVERS_PER_SIDE = 4;

function buildScoreDrivers(factors: ScoreFactor[]): { positive: ScoreDriverRow[]; negative: ScoreDriverRow[] } {
  const rows = factors
    .filter((f) => f.contribution !== 0)
    .map((f): ScoreDriverRow => ({ key: f.key, label: factorLabel(f.key), contribution: f.contribution, explanation: f.explanation, freshness: f.freshness }));

  const positive = rows
    .filter((r) => r.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, MAX_DRIVERS_PER_SIDE);
  const negative = rows
    .filter((r) => r.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, MAX_DRIVERS_PER_SIDE);

  return { positive, negative };
}

// ---- Data-quality / trust summary (Phase 8) ----
// A compact per-freshness count across all 9 score.factors — e.g. "9
// factors — 6 live, 2 delayed, 1 not applicable" — purely a tally of
// values already on score.factors, no I/O, no new classification.
export type DataQualitySummary = { total: number; counts: Partial<Record<DataFreshness, number>> };

function buildDataQualitySummary(factors: ScoreFactor[]): DataQualitySummary {
  const counts: Partial<Record<DataFreshness, number>> = {};
  for (const f of factors) counts[f.freshness] = (counts[f.freshness] ?? 0) + 1;
  return { total: factors.length, counts };
}

// ---- Technicals section — derived directly from score.factors, no fetch ----
export type TechnicalsRow = { label: string; classification: FactorSentiment; explanation: string; freshness: DataFreshness; lastUpdated: string; source: string };

function buildTechnicalsRows(factors: ScoreFactor[]): TechnicalsRow[] {
  const rows: TechnicalsRow[] = [];
  const technical = factors.find((f) => f.key === "technical");
  if (technical) rows.push({ label: "4H / Daily Chart Trend", classification: factorSentiment(technical.contribution), explanation: technical.explanation, freshness: technical.freshness, lastUpdated: technical.lastUpdated, source: technical.source });
  const seasonality = factors.find((f) => f.key === "seasonality");
  if (seasonality) rows.push({ label: "Seasonality Trend", classification: factorSentiment(seasonality.contribution), explanation: seasonality.explanation, freshness: seasonality.freshness, lastUpdated: seasonality.lastUpdated, source: seasonality.source });
  return rows;
}

// ---- Economic Growth / Inflation / Jobs Market / Interest Rates — real
// calendar rows ----
// Forecast/Previous/RevisedPrevious are exactly what economic_events stores
// (Forex Factory calendar / manual admin entry / Zapier email ingestion —
// see lib/ingestion — all write through the same table and columns) —
// never derived, never guessed. `forecast`/`previous` are null (rendered as
// "—", never a fabricated number) when the underlying release genuinely
// carries no forecast/previous value.
export type IndicatorRow = {
  label: string;
  indicatorKey: EconomicIndicatorKey;
  classification: IndicatorClassification | null; // null when forecast is unavailable, or (rate decisions) when no established asset-specific transmission model exists — never fabricated
  actual: number;
  forecast: number | null;
  previous: number | null;
  revisedPrevious: number | null;
  surprise: number | null; // actual - forecast; null when forecast is null
  date: string; // ISO
  source: string;
};

type IndicatorRowDef = { label: string; keys: EconomicIndicatorKey[] };

// FX pairs get their base currency's country as the "primary" macro read —
// the same country macro.ts's own generic model treats as primary for
// every non-FX asset (instrument.macroCountry ?? "US"); for FX specifically
// this mirrors macro.ts's own two-country differential's base side, not a
// change to how V1 actually scores FX (this is a display-only read).
export function primaryMacroCountry(instrument: Instrument): string {
  if (instrument.currencies) return CCY_TO_COUNTRY[instrument.currencies[0]] ?? "US";
  return instrument.macroCountry ?? "US";
}

const GROWTH_INDICATORS: IndicatorRowDef[] = [
  { label: "GDP Growth QoQ", keys: ["gdp"] },
  { label: "Manufacturing PMI", keys: ["ismManufacturing", "spGlobalManufacturingPmi"] },
  { label: "Services PMI", keys: ["ismServices", "spGlobalServicesPmi"] },
  { label: "Retail Sales MoM", keys: ["retailSales"] },
  { label: "Consumer Confidence", keys: ["consumerConfidence", "michiganSentiment"] },
];

const INFLATION_INDICATORS: IndicatorRowDef[] = [
  { label: "CPI YoY", keys: ["cpi"] },
  { label: "Core CPI YoY", keys: ["coreCpi"] },
  { label: "PPI YoY", keys: ["ppi"] },
  { label: "Core PPI YoY", keys: ["corePpi"] },
  { label: "PCE YoY", keys: ["pce"] },
  { label: "Core PCE YoY", keys: ["corePce"] },
];

const JOBS_INDICATORS: IndicatorRowDef[] = [
  { label: "Non-Farm Payrolls", keys: ["nfp"] },
  { label: "Unemployment Rate", keys: ["unemploymentRate"] },
  { label: "Weekly Jobless Claims", keys: ["joblessClaims"] },
  { label: "ADP Employment", keys: ["adpEmployment"] },
  { label: "JOLTS Job Openings", keys: ["jolts"] },
  { label: "Average Hourly Earnings", keys: ["avgHourlyEarnings"] },
];

// Central-bank rate-decision release per country, for the Interest Rates
// section's release-style rows (Fed Funds Rate/BoE/BoJ/... Actual/
// Forecast/Previous/Surprise) — reuses the SAME rate-decision indicatorKeys
// indicator-taxonomy.ts already classifies calendar events into.
const RATE_DECISION_BY_COUNTRY: Partial<Record<string, { key: EconomicIndicatorKey; label: string }>> = {
  US: { key: "fedRateDecision", label: "Fed Funds Rate" },
  EU: { key: "ecbRateDecision", label: "ECB Rate Decision" },
  GB: { key: "boeRateDecision", label: "BoE Rate Decision" },
  JP: { key: "bojRateDecision", label: "BoJ Rate Decision" },
  CH: { key: "snbRateDecision", label: "SNB Rate Decision" },
  CA: { key: "bocRateDecision", label: "BoC Rate Decision" },
  AU: { key: "rbaRateDecision", label: "RBA Rate Decision" },
  NZ: { key: "rbnzRateDecision", label: "RBNZ Rate Decision" },
};

function toIndicatorRow(instrument: Instrument, label: string, key: EconomicIndicatorKey, stored: StoredEconomicEventRow, classification: IndicatorClassification | null): IndicatorRow {
  return {
    label,
    indicatorKey: key,
    classification,
    actual: stored.actual,
    forecast: stored.forecast,
    previous: stored.previous,
    revisedPrevious: stored.revisedPrevious,
    surprise: stored.forecast !== null ? stored.actual - stored.forecast : null,
    date: stored.dateTime,
    source: `Economic calendar — ${stored.event}`,
  };
}

/** Looks up each candidate indicatorKey in order (a primary vendor-naming
 * convention, e.g. ismManufacturing, falling back to an equivalent when the
 * primary hasn't been released/classified yet, e.g.
 * spGlobalManufacturingPmi) against the already-fetched batched events map
 * and returns the first with a real stored release. Pure/synchronous — the
 * one DB read for every indicator this Scorecard needs already happened in
 * buildScorecardData's single getLatestEconomicEventsByIndicators call.
 * Rows with no data from any candidate are omitted entirely — never a
 * fabricated placeholder row. */
function resolveIndicatorRows(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, country: string, defs: IndicatorRowDef[]): IndicatorRow[] {
  const rows: IndicatorRow[] = [];
  for (const def of defs) {
    for (const key of def.keys) {
      const stored = events.get(`${country}:${key}`);
      if (stored) {
        rows.push(toIndicatorRow(instrument, def.label, key, stored, classifyIndicatorSurprise(instrument, key, stored.actual, stored.forecast)));
        break;
      }
    }
  }
  return rows;
}

/** Release-style rows for whichever countries' central-bank rate decisions
 * are in scope for this instrument (FX: base + quote; everything else: its
 * one primary country) — same batched events map, no extra query. No Bias
 * is assigned: unlike growth/inflation/jobs, this codebase has no
 * established asset-specific transmission model for a rate-decision
 * surprise (hawkish/dovish is not simply "actual above forecast = strong"),
 * so `classification` stays null rather than a fabricated guess. */
function resolveRateDecisionRows(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, countries: string[]): IndicatorRow[] {
  const rows: IndicatorRow[] = [];
  for (const c of countries) {
    const decision = RATE_DECISION_BY_COUNTRY[c];
    if (!decision) continue;
    const stored = events.get(`${c}:${decision.key}`);
    if (!stored) continue;
    rows.push(toIndicatorRow(instrument, decision.label, decision.key, stored, null));
  }
  return rows;
}

// ---- Macro State fallback (used only when the calendar has no released
// indicators at all for a category, e.g. FMP's economic-calendar endpoint
// is unavailable) — built from the SAME real FRED series already powering
// macro.ts's economicGrowth/inflation/labor factors, via the SAME real
// trend computation (macro-differential.ts's scoreIndicator) the score
// itself uses. Never a fabricated forecast/surprise — there is no forecast
// concept here, only a genuine period-over-period change in a real stored
// series. A section still renders "unavailable" (never a blank/empty
// table) when even this has no usable series or history for the country. ----
export type MacroStateRow = {
  label: string;
  value: number;
  previousValue: number;
  changeAbs: number;
  changePct: number | null;
  trend: Trend;
  classification: IndicatorClassification;
  date: string;
  freshness: DataFreshness;
  source: string;
};

export type IndicatorSection = { kind: "calendar"; rows: IndicatorRow[] } | { kind: "macro-state"; rows: MacroStateRow[] } | { kind: "unavailable"; reason: string };

type MacroStateDef = { label: string; fredKey: FredIndicatorKey; trendKind: MacroTrendKind };

async function resolveMacroStateRow(instrument: Instrument, country: string, def: MacroStateDef, storageOnly: boolean): Promise<MacroStateRow | { reason: string }> {
  const result = await getFredSeriesWithFallback(country, def.fredKey, 24, storageOnly);
  const usable = (result.status === "live" || result.status === "delayed" || result.status === "stale") && result.value && result.value.length > 0;
  if (!usable) return { reason: result.error ?? `No verified FRED series configured for ${country}/${def.fredKey}` };

  const scored = scoreIndicator(def.fredKey, result.value!);
  if (!scored) return { reason: "Insufficient FRED observation history to compute a trend (need at least 3 data points)" };

  return {
    label: def.label,
    value: scored.currentValue,
    previousValue: scored.previousValue,
    changeAbs: scored.changeAbs,
    changePct: scored.changePct,
    trend: scored.trend,
    classification: classifyMacroTrend(instrument, def.trendKind, scored.changeAbs),
    date: result.value![result.value!.length - 1].date,
    freshness: result.status,
    source: result.source,
  };
}

function resolveIndicatorSection(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, country: string, defs: IndicatorRowDef[], macroFallback: MacroStateDef, storageOnly: boolean): Promise<IndicatorSection> {
  const rows = resolveIndicatorRows(events, instrument, country, defs);
  if (rows.length > 0) return Promise.resolve({ kind: "calendar", rows });

  return resolveMacroStateRow(instrument, country, macroFallback, storageOnly).then((macroRow) =>
    "reason" in macroRow ? { kind: "unavailable", reason: macroRow.reason } : { kind: "macro-state", rows: [macroRow] }
  );
}

// ---- Interest Rates section ----
// Gold's is the SAME real, asset-specific driver breakdown (real 10Y
// yield, USD, 2Y yield/Fed-cut expectations, VIX) already computed by
// gold-macro.ts for the actual score — reused directly, not recomputed.
// Every other instrument gets a simpler current-policy-rate (+ FX
// differential, + 2Y yield where resolvable) read, storage-first via the
// same getFredSeriesWithFallback every other macro factor already uses.
// `releases` (both variants) is the actual central-bank rate-DECISION
// release, when one is stored for a country in scope — kept separate from
// `policyRate`/`differential` above, which are FRED's continuously-updated
// policy-rate LEVEL, not a discrete forecast-vs-actual release event; the
// two are complementary, never merged into one fabricated number.
export type InterestRatesSection =
  | { kind: "gold-drivers"; drivers: GoldMacroDriver[]; freshness: DataFreshness; releases: IndicatorRow[] }
  | {
      kind: "generic";
      policyRate: CardResult<{ rate: number; date: string }>;
      differential: CardResult<{ baseRate: number; quoteRate: number; diffPts: number }> | null;
      yield2y: CardResult<{ rate: number; date: string }>;
      releases: IndicatorRow[];
    };

async function resolveLatestFredPoint(country: string, indicator: "policyRate" | "yield2y", storageOnly: boolean): Promise<CardResult<{ rate: number; date: string }>> {
  const result = await getFredSeriesWithFallback(country, indicator, 6, storageOnly);
  const usable = (result.status === "live" || result.status === "delayed" || result.status === "stale") && result.value && result.value.length > 0;
  if (!usable) {
    return { data: null, freshness: result.status === "error" ? "error" : "unavailable", source: result.source, lastUpdated: null, reason: result.error };
  }
  const latest = result.value![result.value!.length - 1];
  return { data: { rate: latest.value, date: latest.date }, freshness: result.status, source: result.source, lastUpdated: result.sourceUpdatedAt };
}

async function resolveInterestRatesSection(instrument: Instrument, country: string, events: Map<string, StoredEconomicEventRow>, storageOnly: boolean): Promise<InterestRatesSection> {
  if (instrument.symbol === GOLD_SYMBOL) {
    const regime = await computeGoldMacroRegime(60, storageOnly);
    return { kind: "gold-drivers", drivers: regime.drivers, freshness: regime.interestRatesFreshness, releases: resolveRateDecisionRows(events, instrument, [country]) };
  }

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const baseCountry = CCY_TO_COUNTRY[base];
    const quoteCountry = CCY_TO_COUNTRY[quote];
    const [baseRate, quoteRate, yield2y] = await Promise.all([
      resolveLatestFredPoint(baseCountry, "policyRate", storageOnly),
      resolveLatestFredPoint(quoteCountry, "policyRate", storageOnly),
      resolveLatestFredPoint(country, "yield2y", storageOnly),
    ]);
    const differential: CardResult<{ baseRate: number; quoteRate: number; diffPts: number }> =
      baseRate.data && quoteRate.data
        ? {
            data: { baseRate: baseRate.data.rate, quoteRate: quoteRate.data.rate, diffPts: baseRate.data.rate - quoteRate.data.rate },
            freshness: worseOf(baseRate.freshness, quoteRate.freshness),
            source: `FRED policy rates — ${base} vs ${quote}`,
            lastUpdated: baseRate.lastUpdated,
          }
        : { data: null, freshness: "unavailable", source: "FRED policy rates", lastUpdated: null, reason: "Missing verified policy-rate series for one or both currencies" };
    return { kind: "generic", policyRate: baseRate, differential, yield2y, releases: resolveRateDecisionRows(events, instrument, [baseCountry, quoteCountry]) };
  }

  const [policyRate, yield2y] = await Promise.all([resolveLatestFredPoint(country, "policyRate", storageOnly), resolveLatestFredPoint(country, "yield2y", storageOnly)]);
  return { kind: "generic", policyRate, differential: null, yield2y, releases: resolveRateDecisionRows(events, instrument, [country]) };
}

// ---- Currency Comparison (FX-only) ----
// The "Scorecard" rename (was the standalone /forex-scorecard page) folds
// the FX-specific base-vs-quote comparison directly into the per-
// instrument Scorecard instead of maintaining a second deep-dive page —
// reuses forex-scorecard.ts's already-composed differentials/bands/
// narrative verbatim, no new math. null for every non-FX instrument
// (nothing forced onto assets it doesn't apply to).
export async function resolveCurrencyComparison(instrument: Instrument, storageOnly: boolean): Promise<ForexScorecardData | null> {
  if (!instrument.currencies) return null;
  return buildForexScorecard(instrument.symbol, storageOnly);
}

// ---- "Latest COT Changes" — plain-English read of the same net-weekly-
// change/direction fields already shown in the Institutional Activity
// numbers above; no new fetch, no new classification beyond a label. ----
export type CotChangeLabel = "Increasing longs" | "Increasing shorts" | "Reducing longs" | "Reducing shorts" | "Little change";

// `direction` here is the net-positioning direction CFTC's own client
// already computes (cftc.ts: "Bullish" net-long / "Bearish" net-short /
// "Neutral") — there's no separately-stored long-side vs. short-side
// weekly delta, so a growing net-long position reads as "Increasing
// longs" and a shrinking one as "Reducing longs" (and the mirror for a
// net-short position), the same convention market commentary uses when
// only the net change is available.
export function cotChangeLabel(data: Pick<InstitutionalCardData, "direction" | "netWeeklyChange">): CotChangeLabel {
  if (Math.abs(data.netWeeklyChange) < 1) return "Little change";
  if (data.direction === "Bullish") return data.netWeeklyChange > 0 ? "Increasing longs" : "Reducing longs";
  if (data.direction === "Bearish") return data.netWeeklyChange < 0 ? "Increasing shorts" : "Reducing shorts";
  return "Little change";
}

// ---- News & Market Context ----
// Composed entirely from fields the real ingestion pipeline already
// classified at write time (news-classifier.ts's importance/geopolitical-
// relevance/monetary-policy-relevance/risk-sentiment) — no new provider
// call, no new LLM summarization at render time, nothing invented. Reuses
// getLiveNewsFeed/getUpcomingHighImpactEvents, the same bounded reads the
// Dashboard already makes elsewhere, filtered to this instrument's own
// affected markets/currencies.
export type NewsContextSection = {
  latest: ClientNewsArticle[];
  monetaryPolicy: ClientNewsArticle | null;
  geopolitical: ClientNewsArticle | null;
  riskSentiment: ClientNewsArticle["riskSentiment"] | null;
  upcomingEvent: StoredCalendarEvent | null;
};

const NEWS_CONTEXT_FEED_LIMIT = 60;
const NEWS_CONTEXT_MAX_LATEST = 3;
const NEWS_CONTEXT_EVENT_WINDOW_HOURS = 24 * 14;
const NEWS_CONTEXT_EVENT_SCAN_LIMIT = 30;
const RELEVANCE_THRESHOLD = 50;

export async function resolveNewsContext(instrument: Instrument): Promise<NewsContextSection> {
  const relatedTickers = instrument.currencies ?? [instrument.symbol];
  const [feed, events] = await Promise.all([
    getLiveNewsFeed(NEWS_CONTEXT_FEED_LIMIT),
    getUpcomingHighImpactEvents(NEWS_CONTEXT_EVENT_WINDOW_HOURS, NEWS_CONTEXT_EVENT_SCAN_LIMIT),
  ]);

  const related = feed.filter((n) => n.affectedMarkets.includes(instrument.symbol) || n.affectedMarkets.some((m) => relatedTickers.includes(m)));
  const latest = [...related].sort((a, b) => b.importance - a.importance).slice(0, NEWS_CONTEXT_MAX_LATEST);

  const byMonetaryRelevance = [...related].sort((a, b) => (b.monetaryPolicyRelevance ?? 0) - (a.monetaryPolicyRelevance ?? 0));
  const monetaryPolicy = (byMonetaryRelevance[0]?.monetaryPolicyRelevance ?? 0) >= RELEVANCE_THRESHOLD ? byMonetaryRelevance[0] : null;

  const byGeoRelevance = [...related].sort((a, b) => (b.geopoliticalRelevance ?? 0) - (a.geopoliticalRelevance ?? 0));
  const geopolitical = (byGeoRelevance[0]?.geopoliticalRelevance ?? 0) >= RELEVANCE_THRESHOLD ? byGeoRelevance[0] : null;

  const withRiskSentiment = [...related].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()).find((n) => n.riskSentiment);

  const relevantEvents = events.filter((e) => e.affectedMarkets.includes(instrument.symbol) || e.affectedMarkets.some((m) => relatedTickers.includes(m)));

  return {
    latest,
    monetaryPolicy,
    geopolitical,
    riskSentiment: withRiskSentiment?.riskSentiment ?? null,
    upcomingEvent: relevantEvents[0] ?? null,
  };
}

// ---- Composition ----
export type ScorecardData = {
  subScores: ScorecardSubScores;
  scoreDrivers: { positive: ScoreDriverRow[]; negative: ScoreDriverRow[] };
  dataQuality: DataQualitySummary;
  technicals: TechnicalsRow[];
  institutional: CardResult<InstitutionalCardData>;
  retail: CardResult<NormalizedRetailSentiment>;
  economicGrowth: IndicatorSection;
  inflation: IndicatorSection;
  jobsMarket: IndicatorSection;
  interestRates: InterestRatesSection;
  currencyComparison: ForexScorecardData | null;
  newsContext: NewsContextSection;
};

// All indicatorKeys the Growth/Inflation/Jobs Market tables ever look up,
// computed once (module load, not per-render) rather than re-flattened on
// every call.
const GROWTH_INFLATION_JOBS_KEYS: EconomicIndicatorKey[] = [...GROWTH_INDICATORS, ...INFLATION_INDICATORS, ...JOBS_INDICATORS].flatMap((d) => d.keys);

export async function buildScorecardData(instrument: Instrument, score: MarketScore, live: LiveMarketDetail, storageOnly = false): Promise<ScorecardData> {
  const country = primaryMacroCountry(instrument);
  const countries = instrument.currencies ? Array.from(new Set([CCY_TO_COUNTRY[instrument.currencies[0]], CCY_TO_COUNTRY[instrument.currencies[1]]])) : [country];
  const rateDecisionKeys = countries.map((c) => RATE_DECISION_BY_COUNTRY[c]?.key).filter((k): k is EconomicIndicatorKey => !!k);
  const indicatorKeys = Array.from(new Set([...GROWTH_INFLATION_JOBS_KEYS, ...rateDecisionKeys]));

  // ONE batched read for every (country, indicatorKey) pair every macro
  // section below needs — replaces what used to be a separate query per
  // indicator (up to ~20 round trips for a full Scorecard render). See
  // getLatestEconomicEventsByIndicators (db/queries/market-data.ts).
  const events = await getLatestEconomicEventsByIndicators(countries, indicatorKeys);

  const [economicGrowth, inflation, jobsMarket, interestRates, currencyComparison, newsContext] = await Promise.all([
    resolveIndicatorSection(events, instrument, country, GROWTH_INDICATORS, { label: "GDP Growth Rate (QoQ)", fredKey: "gdpGrowth", trendKind: "growth" }, storageOnly),
    resolveIndicatorSection(events, instrument, country, INFLATION_INDICATORS, { label: "CPI (Index level)", fredKey: "cpi", trendKind: "inflation" }, storageOnly),
    resolveIndicatorSection(events, instrument, country, JOBS_INDICATORS, { label: "Unemployment Rate", fredKey: "unemploymentRate", trendKind: "jobs" }, storageOnly),
    resolveInterestRatesSection(instrument, country, events, storageOnly),
    resolveCurrencyComparison(instrument, storageOnly),
    resolveNewsContext(instrument),
  ]);

  return {
    subScores: computeSubScores(score.factors),
    scoreDrivers: buildScoreDrivers(score.factors),
    dataQuality: buildDataQualitySummary(score.factors),
    technicals: buildTechnicalsRows(score.factors),
    // Institutional and Retail are distinct sections/fields — never merged
    // into one "positioning" object — CFTC (institutional) and retail
    // sentiment stay separately keyed exactly as market-detail.ts already
    // resolves them.
    institutional: live.institutional,
    retail: live.retail,
    economicGrowth,
    inflation,
    jobsMarket,
    interestRates,
    currencyComparison,
    newsContext,
  };
}
