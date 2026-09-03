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

// `fredFallback` is only set where a genuinely verified FRED series exists
// for this exact concept (per the real coverage audit against production —
// see conversation history) — omitted entirely rather than guessed where
// none does (e.g. Manufacturing/Services PMI, Consumer Confidence, ADP,
// JOLTS, Wage Growth have no FRED equivalent in this codebase at all).
// `trendKind` governs classifyMacroTrend's sign convention (see
// indicator-classification.ts): "jobs" inverts (higher = weaker, correct
// for unemploymentRate/initialClaims), "growth"/"inflation" don't. NFP
// deliberately has NO fredFallback — FRED's "payrolls" is a raw
// employment LEVEL, not the monthly CHANGE figure "NFP" means to traders;
// showing it as if it were NFP would be misleading, not merely stale.
type IndicatorRowDef = { label: string; keys: EconomicIndicatorKey[]; fredFallback?: { key: FredIndicatorKey; trendKind: MacroTrendKind } };

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
  { label: "GDP Growth QoQ", keys: ["gdp"], fredFallback: { key: "gdpGrowth", trendKind: "growth" } },
  { label: "Manufacturing PMI", keys: ["ismManufacturing", "spGlobalManufacturingPmi"] },
  { label: "Services PMI", keys: ["ismServices", "spGlobalServicesPmi"] },
  { label: "Retail Sales MoM", keys: ["retailSales"], fredFallback: { key: "retailSales", trendKind: "growth" } },
  { label: "Consumer Confidence", keys: ["consumerConfidence", "michiganSentiment"] },
  { label: "Industrial Production", keys: ["industrialProduction"], fredFallback: { key: "industrialProduction", trendKind: "growth" } },
];

const INFLATION_INDICATORS: IndicatorRowDef[] = [
  { label: "CPI YoY", keys: ["cpi"], fredFallback: { key: "cpi", trendKind: "inflation" } },
  { label: "Core CPI YoY", keys: ["coreCpi"], fredFallback: { key: "coreCpi", trendKind: "inflation" } },
  { label: "PPI YoY", keys: ["ppi"], fredFallback: { key: "ppi", trendKind: "inflation" } },
  { label: "Core PPI YoY", keys: ["corePpi"] },
  { label: "PCE YoY", keys: ["pce"], fredFallback: { key: "pce", trendKind: "inflation" } },
  { label: "Core PCE YoY", keys: ["corePce"], fredFallback: { key: "corePce", trendKind: "inflation" } },
];

const JOBS_INDICATORS: IndicatorRowDef[] = [
  { label: "Non-Farm Payrolls", keys: ["nfp"] },
  { label: "Unemployment Rate", keys: ["unemploymentRate"], fredFallback: { key: "unemploymentRate", trendKind: "jobs" } },
  { label: "Weekly Jobless Claims", keys: ["joblessClaims"], fredFallback: { key: "initialClaims", trendKind: "jobs" } },
  { label: "ADP Employment", keys: ["adpEmployment"] },
  { label: "JOLTS Job Openings", keys: ["jolts"] },
  { label: "Average Hourly Earnings", keys: ["avgHourlyEarnings"] },
  // trendKind "growth" (not "jobs") is deliberate: participation rising is
  // conventionally a stronger-economy signal (more people working/looking
  // for work), the same non-inverted polarity as a growth beat — "jobs"
  // would incorrectly invert it the way it correctly does for
  // unemploymentRate/initialClaims (where higher genuinely means weaker).
  { label: "Labor Force Participation", keys: [], fredFallback: { key: "laborParticipation", trendKind: "growth" } },
];

// Central-bank rate-decision release per country, for the Interest Rates
// section's release-style rows (Fed Funds Rate/BoE/BoJ/... Actual/
// Forecast/Previous/Surprise) — reuses the SAME rate-decision indicatorKeys
// indicator-taxonomy.ts already classifies calendar events into.
export const RATE_DECISION_BY_COUNTRY: Partial<Record<string, { key: EconomicIndicatorKey; label: string }>> = {
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
 * buildScorecardData's single getLatestEconomicEventsByIndicators call. */
function lookupCalendarRow(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, country: string, def: IndicatorRowDef): IndicatorRow | null {
  for (const key of def.keys) {
    const stored = events.get(`${country}:${key}`);
    if (stored) return toIndicatorRow(instrument, def.label, key, stored, classifyIndicatorSurprise(instrument, key, stored.actual, stored.forecast));
  }
  return null;
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

// Each row is independently EITHER a real calendar release (preferred —
// Forex Factory / manual admin entry / Zapier) OR the FRED macro-state
// fallback for that SAME indicator (only when no calendar release exists
// for it yet) — never both, never neither shown as a fabricated blend. A
// whole category can show a mix: e.g. USD CPI as a live calendar release
// while USD Core CPI still shows its FRED macro-state row, side by side.
export type IndicatorSectionRow = { source: "calendar"; row: IndicatorRow } | { source: "macro-state"; row: MacroStateRow };
export type IndicatorSection = { kind: "rows"; rows: IndicatorSectionRow[] } | { kind: "unavailable"; reason: string };

type MacroStateDef = { label: string; fredKey: FredIndicatorKey; trendKind: MacroTrendKind };

// Always storage-only (the literal `true` below, never the caller's own
// storageOnly flag) — this macro-state row is purely supplementary
// Scorecard display, never a scoring input, so it must never trigger a
// live FRED API call from the render path. See buildScorecardData's
// batched-events comment for the same principle applied to calendar data.
async function resolveMacroStateRow(instrument: Instrument, country: string, def: MacroStateDef): Promise<MacroStateRow | { reason: string }> {
  const result = await getFredSeriesWithFallback(country, def.fredKey, 24, true);
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

async function resolveIndicatorRow(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, country: string, def: IndicatorRowDef): Promise<IndicatorSectionRow | null> {
  const calendarRow = lookupCalendarRow(events, instrument, country, def);
  if (calendarRow) return { source: "calendar", row: calendarRow };

  if (def.fredFallback) {
    const macroRow = await resolveMacroStateRow(instrument, country, { label: def.label, fredKey: def.fredFallback.key, trendKind: def.fredFallback.trendKind });
    if (!("reason" in macroRow)) return { source: "macro-state", row: macroRow };
  }
  return null;
}

async function resolveIndicatorSection(events: Map<string, StoredEconomicEventRow>, instrument: Instrument, country: string, defs: IndicatorRowDef[]): Promise<IndicatorSection> {
  const resolved = await Promise.all(defs.map((def) => resolveIndicatorRow(events, instrument, country, def)));
  const rows = resolved.filter((r): r is IndicatorSectionRow => r !== null);
  if (rows.length === 0) return { kind: "unavailable", reason: `No released calendar indicators or verified FRED macro-state series are currently stored for ${country} in this category.` };
  return { kind: "rows", rows };
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
      yield10y: CardResult<{ rate: number; date: string }>;
      releases: IndicatorRow[];
    };

// Always storage-only, same principle as resolveMacroStateRow above — this
// is Scorecard display, not a scoring input.
async function resolveLatestFredPoint(country: string, indicator: "policyRate" | "yield2y" | "yield10y"): Promise<CardResult<{ rate: number; date: string }>> {
  const result = await getFredSeriesWithFallback(country, indicator, 6, true);
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
    const [baseRate, quoteRate, yield2y, yield10y] = await Promise.all([
      resolveLatestFredPoint(baseCountry, "policyRate"),
      resolveLatestFredPoint(quoteCountry, "policyRate"),
      resolveLatestFredPoint(country, "yield2y"),
      resolveLatestFredPoint(country, "yield10y"),
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
    return { kind: "generic", policyRate: baseRate, differential, yield2y, yield10y, releases: resolveRateDecisionRows(events, instrument, [baseCountry, quoteCountry]) };
  }

  const [policyRate, yield2y, yield10y] = await Promise.all([resolveLatestFredPoint(country, "policyRate"), resolveLatestFredPoint(country, "yield2y"), resolveLatestFredPoint(country, "yield10y")]);
  return { kind: "generic", policyRate, differential: null, yield2y, yield10y, releases: resolveRateDecisionRows(events, instrument, [country]) };
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
    resolveIndicatorSection(events, instrument, country, GROWTH_INDICATORS),
    resolveIndicatorSection(events, instrument, country, INFLATION_INDICATORS),
    resolveIndicatorSection(events, instrument, country, JOBS_INDICATORS),
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
