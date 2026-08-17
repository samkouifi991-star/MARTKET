import { getInstrument } from "@/lib/instruments";
import { macroFactor as demoMacroFactor, inflationFactorFor as demoInflationFactor, interestRateFactor as demoInterestRateFactor, CCY_TO_COUNTRY } from "@/lib/scoring";
import { computeCountryMacroScores, computeFxDifferential, CountryMacroScores } from "@/lib/engines/macro-differential";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import * as fred from "@/services/market-data/fred";
import { FredSeriesPoint } from "@/services/types";
import { demoFallbackFactor, ResolvedFactor, unavailableFactor } from "./types";
import { DataMode } from "@/services/data-mode";
import { Instrument, ScoreFactorKey } from "@/lib/types";

const GROWTH_INDICATORS: FredIndicatorKey[] = ["realGdp", "gdpGrowth", "industrialProduction", "retailSales"];
const INFLATION_INDICATORS: FredIndicatorKey[] = ["cpi", "coreCpi", "pce", "corePce", "ppi"];
const LABOR_INDICATORS: FredIndicatorKey[] = ["unemploymentRate", "payrolls", "initialClaims", "wageGrowth", "laborParticipation"];

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

async function fetchCountryScores(country: string, indicators: FredIndicatorKey[]): Promise<CountryMacroScores> {
  const results = await Promise.all(indicators.map((key) => fred.getSeries(country, key)));
  const seriesByIndicator: Partial<Record<FredIndicatorKey, FredSeriesPoint[]>> = {};
  results.forEach((r, i) => {
    if (r.status === "live" && r.value) seriesByIndicator[indicators[i]] = r.value;
  });
  return computeCountryMacroScores(seriesByIndicator);
}

type MacroCategory = "growth" | "inflation" | "labor";

const CATEGORY_META: Record<
  MacroCategory,
  { key: ScoreFactorKey; indicators: FredIndicatorKey[]; label: string; metric: "growthScore" | "laborScore" | "inflationScore"; fallbackSource: string }
> = {
  growth: { key: "economicGrowth", indicators: GROWTH_INDICATORS, label: "economic growth", metric: "growthScore", fallbackSource: "Government & PMI statistical releases (demo)" },
  labor: { key: "labor", indicators: LABOR_INDICATORS, label: "labor market strength", metric: "laborScore", fallbackSource: "Employment & labor-market releases (demo)" },
  inflation: { key: "inflation", indicators: INFLATION_INDICATORS, label: "inflation surprises", metric: "inflationScore", fallbackSource: "CPI / PPI / real-yield composite (demo)" },
};

function demoFallbackFor(category: MacroCategory, instrument: Instrument): ResolvedFactor {
  const meta = CATEGORY_META[category];
  // Inflation's demo logic is genuinely asset-class-dependent (gold vs.
  // equities vs. FX are scored differently) — reuse that specialized
  // function rather than the generic country-differential one growth/labor use.
  const result = category === "inflation" ? demoInflationFactor(instrument) : demoMacroFactor(instrument, meta.metric, meta.label as "economic growth" | "labor market strength");
  return demoFallbackFactor({ key: meta.key, rawScore: result.raw, explanation: result.explanation, source: meta.fallbackSource, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
}

async function resolveMacroCategory(symbol: string, mode: DataMode, category: MacroCategory): Promise<ResolvedFactor> {
  const meta = CATEGORY_META[category];
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor(meta.key, "FRED", `Unknown instrument ${symbol}`);

  const fallback = () => demoFallbackFor(category, instrument);

  const source = "FRED (Federal Reserve Economic Data)";

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const [baseScores, quoteScores] = await Promise.all([
      fetchCountryScores(CCY_TO_COUNTRY[base], meta.indicators),
      fetchCountryScores(CCY_TO_COUNTRY[quote], meta.indicators),
    ]);
    const baseVal = category === "growth" ? baseScores.growthScore : category === "labor" ? baseScores.laborScore : baseScores.inflationScore;
    const quoteVal = category === "growth" ? quoteScores.growthScore : category === "labor" ? quoteScores.laborScore : quoteScores.inflationScore;
    const differential = computeFxDifferential(baseVal, quoteVal);

    if (differential === null) {
      return mode === "hybrid" ? fallback() : unavailableFactor(meta.key, source, `Insufficient verified FRED coverage for ${base} and/or ${quote} ${category} indicators`);
    }

    return {
      key: meta.key,
      rawScore: differential,
      explanation: `${base} ${meta.label} score ${baseVal! > 0 ? "+" : ""}${baseVal!.toFixed(1)} vs. ${quote} at ${quoteVal! > 0 ? "+" : ""}${quoteVal!.toFixed(1)} — evaluated as a differential between both economies from real FRED data, not in isolation.`,
      source,
      provider: "fred",
      freshness: "live",
      lastUpdated: new Date().toISOString(),
      nextUpdate: new Date().toISOString(),
    };
  }

  const weight = instrument.assetClass === "Indices" ? 0.8 : instrument.assetClass === "Crypto" ? 0.35 : 0.45;
  const usScores = await fetchCountryScores("US", meta.indicators);
  const usVal = category === "growth" ? usScores.growthScore : category === "labor" ? usScores.laborScore : usScores.inflationScore;
  if (usVal === null) return mode === "hybrid" ? fallback() : unavailableFactor(meta.key, source, "Insufficient verified FRED coverage for US indicators");

  return {
    key: meta.key,
    rawScore: clamp(usVal * weight),
    explanation: `US ${meta.label} score is ${usVal > 0 ? "+" : ""}${usVal.toFixed(1)} (real FRED data), applied as a global risk-appetite proxy scaled for ${instrument.assetClass.toLowerCase()}.`,
    source,
    provider: "fred",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}

export const resolveEconomicGrowthFactor = (symbol: string, mode: DataMode) => resolveMacroCategory(symbol, mode, "growth");
export const resolveLaborFactor = (symbol: string, mode: DataMode) => resolveMacroCategory(symbol, mode, "labor");

export const resolveInflationFactor = (symbol: string, mode: DataMode) => resolveMacroCategory(symbol, mode, "inflation");

export async function resolveInterestRatesFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol) as Instrument | undefined;
  if (!instrument) return unavailableFactor("interestRates", "FRED", `Unknown instrument ${symbol}`);
  const source = "FRED (central bank policy & yield curves)";

  const fallback = () => {
    const result = demoInterestRateFactor(instrument);
    return demoFallbackFactor({ key: "interestRates", rawScore: result.raw, explanation: result.explanation, source: "Central bank policy & yield curves (demo)", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
  };

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const [baseRates, quoteRates] = await Promise.all([fetchLatestRates(CCY_TO_COUNTRY[base]), fetchLatestRates(CCY_TO_COUNTRY[quote])]);
    if (baseRates.policyRate === null || quoteRates.policyRate === null) {
      return mode === "hybrid" ? fallback() : unavailableFactor("interestRates", source, `Missing verified policy-rate series for ${base} and/or ${quote}`);
    }
    const diff = clamp((baseRates.policyRate - quoteRates.policyRate) * 4);
    return {
      key: "interestRates",
      rawScore: diff,
      explanation: `${base} policy rate ${baseRates.policyRate}% vs. ${quote} at ${quoteRates.policyRate}% — a ${(baseRates.policyRate - quoteRates.policyRate).toFixed(2)}pt differential (FRED).`,
      source,
      provider: "fred",
      freshness: "live",
      lastUpdated: new Date().toISOString(),
      nextUpdate: new Date().toISOString(),
    };
  }

  const usRates = await fetchLatestRates("US");
  if (usRates.policyRate === null) return mode === "hybrid" ? fallback() : unavailableFactor("interestRates", source, "Missing verified US policy-rate series");
  const scale = instrument.assetClass === "Crypto" ? 0.7 : instrument.assetClass === "Indices" ? 0.8 : 0.9;
  // Without a stance classifier from FRED alone, use the rate's own recent
  // trend direction as a simple hawkish(+)/dovish(-) proxy for non-FX assets.
  const trendSign = usRates.trend;
  return {
    key: "interestRates",
    rawScore: clamp(-trendSign * scale * 5),
    explanation: `US policy rate is ${usRates.policyRate}% and ${trendSign > 0 ? "trending higher" : trendSign < 0 ? "trending lower" : "holding steady"} (FRED), weighing on rate-sensitive assets accordingly.`,
    source,
    provider: "fred",
    freshness: "live",
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}

async function fetchLatestRates(country: string): Promise<{ policyRate: number | null; trend: number }> {
  const result = await fred.getSeries(country, "policyRate", 6);
  if (result.status !== "live" || !result.value || result.value.length === 0) return { policyRate: null, trend: 0 };
  const points = result.value;
  const current = points[points.length - 1].value;
  const previous = points[0].value;
  return { policyRate: current, trend: Math.sign(current - previous) };
}
