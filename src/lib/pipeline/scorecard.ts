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
import { getLatestEconomicEventByIndicator } from "@/db/queries/market-data";
import { getRecentReleaseTracking } from "@/db/queries/release-tracking";
import { getSurpriseById } from "@/db/queries/economic-releases";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { NormalizedRetailSentiment } from "@/services/market-data/retail-sentiment";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { scoreIndicator, Trend } from "@/lib/engines/macro-differential";
import { classifyIndicatorSurprise, classifyMacroTrend, IndicatorClassification, MacroTrendKind } from "./indicator-classification";
import { computeGoldMacroRegime, GOLD_SYMBOL, GoldMacroDriver } from "./gold-macro";
import { InstitutionalCardData, LiveMarketDetail } from "./market-detail";
import { CardResult, worseOf } from "./types";

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

// ---- Economic Growth / Inflation / Jobs Market — real calendar rows ----
export type IndicatorRow = {
  label: string;
  indicatorKey: EconomicIndicatorKey;
  classification: IndicatorClassification | null; // null when forecast is unavailable — never fabricated
  actual: number;
  forecast: number | null;
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
function primaryMacroCountry(instrument: Instrument): string {
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
  { label: "PCE YoY", keys: ["pce"] },
];

const JOBS_INDICATORS: IndicatorRowDef[] = [
  { label: "Non-Farm Payrolls", keys: ["nfp"] },
  { label: "Unemployment Rate", keys: ["unemploymentRate"] },
  { label: "Weekly Jobless Claims", keys: ["joblessClaims"] },
  { label: "ADP Employment", keys: ["adpEmployment"] },
  { label: "JOLTS Job Openings", keys: ["jolts"] },
  { label: "Average Hourly Earnings", keys: ["avgHourlyEarnings"] },
];

/** Tries each candidate indicatorKey in order (a primary vendor-naming
 * convention, e.g. ismManufacturing, falling back to an equivalent when the
 * primary hasn't been released/classified yet, e.g.
 * spGlobalManufacturingPmi) and returns the first with a real stored
 * release. Rows with no data from any candidate are omitted entirely —
 * never a fabricated placeholder row. */
async function resolveIndicatorRows(instrument: Instrument, country: string, defs: IndicatorRowDef[]): Promise<IndicatorRow[]> {
  const resolved = await Promise.all(
    defs.map(async (def): Promise<IndicatorRow | null> => {
      for (const key of def.keys) {
        const stored = await getLatestEconomicEventByIndicator(country, key);
        if (stored) {
          return {
            label: def.label,
            indicatorKey: key,
            classification: classifyIndicatorSurprise(instrument, key, stored.actual, stored.forecast),
            actual: stored.actual,
            forecast: stored.forecast,
            surprise: stored.forecast !== null ? stored.actual - stored.forecast : null,
            date: stored.dateTime,
            source: `FMP Economic Calendar — ${stored.event}`,
          };
        }
      }
      return null;
    })
  );
  return resolved.filter((r): r is IndicatorRow => r !== null);
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

async function resolveIndicatorSection(instrument: Instrument, country: string, defs: IndicatorRowDef[], macroFallback: MacroStateDef, storageOnly: boolean): Promise<IndicatorSection> {
  const rows = await resolveIndicatorRows(instrument, country, defs);
  if (rows.length > 0) return { kind: "calendar", rows };

  const macroRow = await resolveMacroStateRow(instrument, country, macroFallback, storageOnly);
  if ("reason" in macroRow) return { kind: "unavailable", reason: macroRow.reason };
  return { kind: "macro-state", rows: [macroRow] };
}

// ---- Interest Rates section ----
// Gold's is the SAME real, asset-specific driver breakdown (real 10Y
// yield, USD, 2Y yield/Fed-cut expectations, VIX) already computed by
// gold-macro.ts for the actual score — reused directly, not recomputed.
// Every other instrument gets a simpler current-policy-rate (+ FX
// differential, + 2Y yield where resolvable) read, storage-first via the
// same getFredSeriesWithFallback every other macro factor already uses.
export type InterestRatesSection =
  | { kind: "gold-drivers"; drivers: GoldMacroDriver[]; freshness: DataFreshness }
  | {
      kind: "generic";
      policyRate: CardResult<{ rate: number; date: string }>;
      differential: CardResult<{ baseRate: number; quoteRate: number; diffPts: number }> | null;
      yield2y: CardResult<{ rate: number; date: string }>;
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

async function resolveInterestRatesSection(instrument: Instrument, country: string, storageOnly: boolean): Promise<InterestRatesSection> {
  if (instrument.symbol === GOLD_SYMBOL) {
    const regime = await computeGoldMacroRegime(60, storageOnly);
    return { kind: "gold-drivers", drivers: regime.drivers, freshness: regime.interestRatesFreshness };
  }

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const [baseRate, quoteRate, yield2y] = await Promise.all([
      resolveLatestFredPoint(CCY_TO_COUNTRY[base], "policyRate", storageOnly),
      resolveLatestFredPoint(CCY_TO_COUNTRY[quote], "policyRate", storageOnly),
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
    return { kind: "generic", policyRate: baseRate, differential, yield2y };
  }

  const [policyRate, yield2y] = await Promise.all([resolveLatestFredPoint(country, "policyRate", storageOnly), resolveLatestFredPoint(country, "yield2y", storageOnly)]);
  return { kind: "generic", policyRate, differential: null, yield2y };
}

// ---- Economic Surprise Index (V2 shadow — read-only) ----
// Reads the exact same V2 queries /admin/scoring-v2's Event Monitor
// already uses (getRecentReleaseTracking, getSurpriseById) — nothing new
// is written, nothing feeds back into `score`. affectedMarkets is already
// populated on each tracking row once a release is processed (see
// release-watch.ts), so filtering to this symbol needs no extra join.
export type SurpriseIndexRow = {
  indicatorKey: EconomicIndicatorKey;
  country: string;
  actual: number;
  forecast: number | null;
  surprise: number | null;
  surpriseZ: number | null;
  importanceTier: string;
  date: string;
};

export type SurpriseIndexSection = {
  rows: SurpriseIndexRow[];
  // True when there's too little real V2 release history yet to be more
  // than a preview — the UI must label this "limited/shadow data" rather
  // than implying a complete surprise index, per spec.
  limited: boolean;
};

const SURPRISE_INDEX_TRACKING_SCAN_LIMIT = 200;
const SURPRISE_INDEX_MAX_ROWS = 10;
const SURPRISE_INDEX_LIMITED_THRESHOLD = 3;

async function resolveSurpriseIndexSection(symbol: string): Promise<SurpriseIndexSection> {
  const tracking = await getRecentReleaseTracking(SURPRISE_INDEX_TRACKING_SCAN_LIMIT);
  const relevant = tracking.filter((r) => r.surpriseId !== null && r.affectedMarkets.includes(symbol)).slice(0, SURPRISE_INDEX_MAX_ROWS);

  const rows = (
    await Promise.all(
      relevant.map(async (r): Promise<SurpriseIndexRow | null> => {
        const surprise = await getSurpriseById(r.surpriseId!);
        if (!surprise) return null;
        return {
          indicatorKey: r.indicatorKey,
          country: r.country,
          actual: surprise.actual,
          forecast: surprise.forecast,
          surprise: surprise.surprise,
          surpriseZ: surprise.surpriseZ,
          importanceTier: r.importanceTier,
          date: r.processedAt ?? r.scheduledAt,
        };
      })
    )
  ).filter((r): r is SurpriseIndexRow => r !== null);

  return { rows, limited: rows.length < SURPRISE_INDEX_LIMITED_THRESHOLD };
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
  surpriseIndex: SurpriseIndexSection;
};

export async function buildScorecardData(instrument: Instrument, score: MarketScore, live: LiveMarketDetail, storageOnly = false): Promise<ScorecardData> {
  const country = primaryMacroCountry(instrument);
  const [economicGrowth, inflation, jobsMarket, interestRates, surpriseIndex] = await Promise.all([
    resolveIndicatorSection(instrument, country, GROWTH_INDICATORS, { label: "GDP Growth Rate (QoQ)", fredKey: "gdpGrowth", trendKind: "growth" }, storageOnly),
    resolveIndicatorSection(instrument, country, INFLATION_INDICATORS, { label: "CPI (Index level)", fredKey: "cpi", trendKind: "inflation" }, storageOnly),
    resolveIndicatorSection(instrument, country, JOBS_INDICATORS, { label: "Unemployment Rate", fredKey: "unemploymentRate", trendKind: "jobs" }, storageOnly),
    resolveInterestRatesSection(instrument, country, storageOnly),
    resolveSurpriseIndexSection(instrument.symbol),
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
    surpriseIndex,
  };
}
