import { getInstrument } from "@/lib/instruments";
import { macroFactor as demoMacroFactor, inflationFactorFor as demoInflationFactor, interestRateFactor as demoInterestRateFactor, CCY_TO_COUNTRY } from "@/lib/scoring";
import { computeCountryMacroScores, computeFxDifferential, CountryMacroScores } from "@/lib/engines/macro-differential";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { FredSeriesPoint } from "@/services/types";
import { demoFallbackFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";
import { DataFreshness, Instrument, ScoreFactorKey } from "@/lib/types";
import { growthLaborPolarity } from "./asset-polarity";
import { GOLD_SYMBOL, resolveGoldInflationFactor, resolveGoldInterestRatesFactor } from "./gold-macro";

// API availability and data freshness are separate concepts (see fred.ts):
// a series can resolve successfully while being materially out of date
// (the concrete case: GB CPI resolves fine but FRED's own data lags ~17
// months). Stale/delayed data still contributes to the average — excluding
// it entirely would silently drop real signal — but the worst freshness
// among the indicators that actually contributed is carried up into the
// factor's own freshness, so confidence.ts's existing freshness weighting
// degrades it automatically instead of the factor claiming "live" for data
// that isn't current.
const FRESHNESS_SEVERITY: Partial<Record<DataFreshness, number>> = { live: 0, delayed: 1, stale: 2 };

function worseFreshness(a: DataFreshness | null, b: DataFreshness): DataFreshness {
  if (a === null) return b;
  return (FRESHNESS_SEVERITY[b] ?? 0) > (FRESHNESS_SEVERITY[a] ?? 0) ? b : a;
}

// Exported for lib/pipeline/economic-strength.ts (Phase 4 of the platform
// redesign), which composes the same per-country growth/labor scores and
// policy-rate reads into a per-currency composite — reusing these fetchers
// rather than re-implementing FRED-series fetching a second time.
export const GROWTH_INDICATORS: FredIndicatorKey[] = ["realGdp", "gdpGrowth", "industrialProduction", "retailSales"];
export const INFLATION_INDICATORS: FredIndicatorKey[] = ["cpi", "coreCpi", "pce", "corePce", "ppi"];
export const LABOR_INDICATORS: FredIndicatorKey[] = ["unemploymentRate", "payrolls", "initialClaims", "wageGrowth", "laborParticipation"];

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

export type CountryMacroScoresWithFreshness = CountryMacroScores & { freshness: DataFreshness | null };

export async function fetchCountryScores(country: string, indicators: FredIndicatorKey[], storageOnly: boolean): Promise<CountryMacroScoresWithFreshness> {
  const results = await Promise.all(indicators.map((key) => getFredSeriesWithFallback(country, key, 24, storageOnly)));
  const seriesByIndicator: Partial<Record<FredIndicatorKey, FredSeriesPoint[]>> = {};
  let freshness: DataFreshness | null = null;
  results.forEach((r, i) => {
    // live/delayed/stale all carry real data and contribute to the
    // average; only unavailable/error (no usable series at all) are
    // excluded. classifyFredFreshness() already ruled out garbage-old data
    // being silently read as "live" — it isn't excluded, it's downgraded.
    if ((r.status === "live" || r.status === "delayed" || r.status === "stale") && r.value) {
      seriesByIndicator[indicators[i]] = r.value;
      freshness = worseFreshness(freshness, r.status);
    }
  });
  return { ...computeCountryMacroScores(seriesByIndicator), freshness };
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

async function resolveMacroCategory(symbol: string, mode: DataMode, category: MacroCategory, storageOnly = false): Promise<ResolvedFactor> {
  const meta = CATEGORY_META[category];
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor(meta.key, "FRED", `Unknown instrument ${symbol}`);

  // Gold's inflation read is not a country-CPI differential — it's driven by
  // breakeven inflation expectations net of real yields (see gold-macro.ts's
  // header for why). Bypass the generic model entirely for XAUUSD rather
  // than trying to bend it with a sign flip; growth/labor below still use
  // this function; they're generically shaped (a polarity flip is enough),
  // inflation is not.
  if (category === "inflation" && symbol === GOLD_SYMBOL) return resolveGoldInflationFactor(mode, storageOnly);

  const fallback = () => demoFallbackFor(category, instrument);

  const source = "FRED (Federal Reserve Economic Data)";

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const [baseScores, quoteScores] = await Promise.all([
      fetchCountryScores(CCY_TO_COUNTRY[base], meta.indicators, storageOnly),
      fetchCountryScores(CCY_TO_COUNTRY[quote], meta.indicators, storageOnly),
    ]);
    const baseVal = category === "growth" ? baseScores.growthScore : category === "labor" ? baseScores.laborScore : baseScores.inflationScore;
    const quoteVal = category === "growth" ? quoteScores.growthScore : category === "labor" ? quoteScores.laborScore : quoteScores.inflationScore;
    const differential = computeFxDifferential(baseVal, quoteVal);

    if (differential === null) {
      return allowsDemoFallback(mode, symbol) ? fallback() : unavailableFactor(meta.key, source, `Insufficient verified FRED coverage for ${base} and/or ${quote} ${category} indicators`);
    }

    const freshness = worseFreshness(baseScores.freshness, quoteScores.freshness ?? "live");
    const staleNote = freshness !== "live" ? ` One or both sides include a ${freshness} series (real data, just not current) — confidence reflects this.` : "";
    return {
      key: meta.key,
      rawScore: differential,
      explanation: `${base} ${meta.label} score ${baseVal! > 0 ? "+" : ""}${baseVal!.toFixed(1)} vs. ${quote} at ${quoteVal! > 0 ? "+" : ""}${quoteVal!.toFixed(1)} — evaluated as a differential between both economies from real FRED data, not in isolation.${staleNote}`,
      source,
      provider: "fred",
      freshness,
      lastUpdated: new Date().toISOString(),
      nextUpdate: new Date().toISOString(),
    };
  }

  // Every index has a genuine home market — its macroCountry (defaulting
  // to US) is that index's actual local economy, used as the PRIMARY
  // macro model, not a proxy standing in for something else. Commodities
  // and crypto have no single home-market economy, so US data is used
  // explicitly as a risk-appetite/liquidity proxy instead — crypto gets
  // its own distinct label per spec ("US / Global Liquidity Macro Proxy"),
  // never presented as a country-specific model for the asset.
  const country = instrument.macroCountry ?? "US";
  const weight = instrument.assetClass === "Indices" ? 0.8 : instrument.assetClass === "Crypto" ? 0.35 : 0.45;
  const scores = await fetchCountryScores(country, meta.indicators, storageOnly);
  const val = category === "growth" ? scores.growthScore : category === "labor" ? scores.laborScore : scores.inflationScore;
  if (val === null) return allowsDemoFallback(mode, symbol) ? fallback() : unavailableFactor(meta.key, source, `Insufficient verified FRED coverage for ${country} indicators`);

  const freshness = scores.freshness ?? "live";
  const staleNote = freshness !== "live" ? ` Includes a ${freshness} series — confidence reflects this.` : "";
  const signed = `${val > 0 ? "+" : ""}${val.toFixed(1)}`;

  // Growth/labor strength isn't universally bullish — see asset-polarity.ts.
  // For precious metals (Gold, Silver, Platinum) a stronger economy raises
  // real yields and reduces safe-haven demand, both a headwind for a
  // non-yielding metal, so the sign is flipped here rather than assumed +1
  // the way every other non-FX asset class treats it. Inflation is excluded
  // from this (category !== "inflation" guard) since Gold's inflation read
  // never reaches this branch at all (see the bypass above).
  const polarity = category === "inflation" ? 1 : growthLaborPolarity(instrument);
  const polarityNote = polarity < 0 ? ` Treated as a headwind, not a tailwind, for ${instrument.name} — a stronger economy raises real yields and reduces safe-haven demand.` : "";
  const explanation =
    (instrument.assetClass === "Indices"
      ? `${country} ${meta.label} score is ${signed} (real FRED data) — ${instrument.name}'s primary local macro profile.${staleNote}`
      : instrument.assetClass === "Crypto"
        ? `US ${meta.label} score is ${signed} (real FRED data), used as a US / Global Liquidity Macro Proxy — crypto has no two-country FX differential or single home-market economy to model directly.${staleNote}`
        : `US ${meta.label} score is ${signed} (real FRED data), applied as a global risk-appetite proxy scaled for ${instrument.assetClass.toLowerCase()}.${staleNote}`) + polarityNote;

  return {
    key: meta.key,
    rawScore: clamp(val * weight * polarity),
    explanation,
    source,
    provider: "fred",
    freshness,
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}

export const resolveEconomicGrowthFactor = (symbol: string, mode: DataMode, storageOnly = false) => resolveMacroCategory(symbol, mode, "growth", storageOnly);
export const resolveLaborFactor = (symbol: string, mode: DataMode, storageOnly = false) => resolveMacroCategory(symbol, mode, "labor", storageOnly);

export const resolveInflationFactor = (symbol: string, mode: DataMode, storageOnly = false) => resolveMacroCategory(symbol, mode, "inflation", storageOnly);

export async function resolveInterestRatesFactor(symbol: string, mode: DataMode, storageOnly = false): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol) as Instrument | undefined;
  if (!instrument) return unavailableFactor("interestRates", "FRED", `Unknown instrument ${symbol}`);

  // Gold's "interest rate conditions" are the real-yield/USD-dominant
  // composite (see gold-macro.ts), not a policy-rate trend proxy — the
  // generic model below assumes a rate-sensitive-but-still-generic asset,
  // which is the same "just flip a sign" mistake the spec explicitly warns
  // against for Gold. Bypass entirely for XAUUSD.
  if (symbol === GOLD_SYMBOL) return resolveGoldInterestRatesFactor(mode, storageOnly);

  const source = "FRED (central bank policy & yield curves)";

  const fallback = () => {
    const result = demoInterestRateFactor(instrument);
    return demoFallbackFactor({ key: "interestRates", rawScore: result.raw, explanation: result.explanation, source: "Central bank policy & yield curves (demo)", lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
  };

  if (instrument.currencies) {
    const [base, quote] = instrument.currencies;
    const [baseRates, quoteRates] = await Promise.all([fetchLatestRates(CCY_TO_COUNTRY[base], storageOnly), fetchLatestRates(CCY_TO_COUNTRY[quote], storageOnly)]);
    if (baseRates.policyRate === null || quoteRates.policyRate === null) {
      return allowsDemoFallback(mode, symbol) ? fallback() : unavailableFactor("interestRates", source, `Missing verified policy-rate series for ${base} and/or ${quote}`);
    }
    const diff = clamp((baseRates.policyRate - quoteRates.policyRate) * 4);
    const freshness = worseFreshness(baseRates.freshness, quoteRates.freshness);
    return {
      key: "interestRates",
      rawScore: diff,
      explanation: `${base} policy rate ${baseRates.policyRate}% vs. ${quote} at ${quoteRates.policyRate}% — a ${(baseRates.policyRate - quoteRates.policyRate).toFixed(2)}pt differential (FRED).${freshness !== "live" ? ` One or both policy-rate series are ${freshness} — confidence reflects this.` : ""}`,
      source,
      provider: "fred",
      freshness,
      lastUpdated: new Date().toISOString(),
      nextUpdate: new Date().toISOString(),
    };
  }

  // Same primary-local-model-vs-proxy split as resolveMacroCategory above.
  const country = instrument.macroCountry ?? "US";
  const rates = await fetchLatestRates(country, storageOnly);
  if (rates.policyRate === null) return allowsDemoFallback(mode, symbol) ? fallback() : unavailableFactor("interestRates", source, `Missing verified ${country} policy-rate series`);
  const scale = instrument.assetClass === "Crypto" ? 0.7 : instrument.assetClass === "Indices" ? 0.8 : 0.9;
  // Without a stance classifier from FRED alone, use the rate's own recent
  // trend direction as a simple hawkish(+)/dovish(-) proxy for non-FX assets.
  const trendSign = rates.trend;
  const trendPhrase = trendSign > 0 ? "trending higher" : trendSign < 0 ? "trending lower" : "holding steady";
  const staleNote = rates.freshness !== "live" ? ` Series is ${rates.freshness} — confidence reflects this.` : "";
  const explanation =
    instrument.assetClass === "Indices"
      ? `${country} policy rate is ${rates.policyRate}% and ${trendPhrase} (FRED) — ${instrument.name}'s primary local rate environment, weighing on the index accordingly.${staleNote}`
      : instrument.assetClass === "Crypto"
        ? `US policy rate is ${rates.policyRate}% and ${trendPhrase} (FRED), used as a US / Global Liquidity Macro Proxy for rate-sensitive risk appetite — not a country-specific rate model for crypto.${staleNote}`
        : `US policy rate is ${rates.policyRate}% and ${trendPhrase} (FRED), weighing on rate-sensitive assets accordingly.${staleNote}`;

  return {
    key: "interestRates",
    rawScore: clamp(-trendSign * scale * 5),
    explanation,
    source,
    provider: "fred",
    freshness: rates.freshness,
    lastUpdated: new Date().toISOString(),
    nextUpdate: new Date().toISOString(),
  };
}

export async function fetchLatestRates(country: string, storageOnly: boolean): Promise<{ policyRate: number | null; trend: number; freshness: DataFreshness }> {
  const result = await getFredSeriesWithFallback(country, "policyRate", 6, storageOnly);
  if ((result.status !== "live" && result.status !== "delayed" && result.status !== "stale") || !result.value || result.value.length === 0) {
    return { policyRate: null, trend: 0, freshness: "unavailable" };
  }
  const points = result.value;
  const current = points[points.length - 1].value;
  const previous = points[0].value;
  return { policyRate: current, trend: Math.sign(current - previous), freshness: result.status };
}
