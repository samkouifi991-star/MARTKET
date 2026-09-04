// The canonical set of economic releases Scoring Engine V2 understands,
// independent of any one calendar vendor's free-text event naming. FMP's
// `economics-calendar` endpoint (and any future EconomicCalendarProvider
// adapter — see provider.ts) returns an `event` string like "Core CPI m/m",
// not a structured indicator code, so matchIndicator() below classifies it
// via keyword matching. An event that doesn't match any pattern is left
// unclassified (indicatorKey: null) rather than guessed — matches this
// project's "never fabricate" rule.
export type EconomicIndicatorKey =
  // Inflation
  | "cpi"
  | "coreCpi"
  | "ppi"
  | "corePpi"
  | "pce"
  | "corePce"
  | "inflationExpectations"
  // Labor
  | "nfp"
  | "unemploymentRate"
  | "avgHourlyEarnings"
  | "joblessClaims"
  | "continuingClaims"
  | "jolts"
  | "adpEmployment"
  // Growth
  | "gdp"
  | "gdpRevision"
  | "retailSales"
  | "industrialProduction"
  | "durableGoods"
  | "ismManufacturing"
  | "ismServices"
  | "spGlobalManufacturingPmi"
  | "spGlobalServicesPmi"
  // Central banks / rates
  | "fedRateDecision"
  | "fomcStatement"
  | "dotPlot"
  | "powellPressConference"
  | "fomcMinutes"
  | "ecbRateDecision"
  | "boeRateDecision"
  | "bojRateDecision"
  | "snbRateDecision"
  | "bocRateDecision"
  | "rbaRateDecision"
  | "rbnzRateDecision"
  // Other high-impact
  | "consumerConfidence"
  | "michiganSentiment"
  | "michiganInflationExpectations"
  | "housingData"
  | "tradeBalance"
  | "productivity"
  | "unitLaborCosts";

export type ImportanceTier = "HIGH" | "MEDIUM" | "LOW";

// Per the spec: "Do not treat every release equally." HIGH events (FOMC,
// CPI, NFP, GDP, ...) are the ones capable of moving the score materially
// and persisting longest through event-shock decay (see event-shock.ts).
// LOW events should have little or no effect on the total score.
export const IMPORTANCE_TIER: Record<EconomicIndicatorKey, ImportanceTier> = {
  cpi: "HIGH",
  coreCpi: "HIGH",
  ppi: "MEDIUM",
  corePpi: "MEDIUM",
  pce: "HIGH",
  corePce: "HIGH",
  inflationExpectations: "MEDIUM",
  nfp: "HIGH",
  unemploymentRate: "HIGH",
  // "wages" is explicitly Tier 1 alongside NFP/unemployment in the labor
  // report composite (requirement #11) — bumped from MEDIUM.
  avgHourlyEarnings: "HIGH",
  // Tier 2 per requirement #11's explicit list — bumped from LOW.
  joblessClaims: "MEDIUM",
  continuingClaims: "MEDIUM",
  jolts: "MEDIUM",
  adpEmployment: "MEDIUM",
  gdp: "HIGH",
  gdpRevision: "MEDIUM",
  retailSales: "MEDIUM",
  industrialProduction: "LOW",
  durableGoods: "LOW",
  ismManufacturing: "MEDIUM",
  ismServices: "MEDIUM",
  // Tier 2's "PMIs" per requirement #11 — bumped from LOW.
  spGlobalManufacturingPmi: "MEDIUM",
  spGlobalServicesPmi: "MEDIUM",
  fedRateDecision: "HIGH",
  fomcStatement: "HIGH",
  dotPlot: "HIGH",
  powellPressConference: "HIGH",
  fomcMinutes: "MEDIUM",
  ecbRateDecision: "HIGH",
  boeRateDecision: "HIGH",
  bojRateDecision: "HIGH",
  snbRateDecision: "MEDIUM",
  bocRateDecision: "MEDIUM",
  rbaRateDecision: "MEDIUM",
  rbnzRateDecision: "MEDIUM",
  consumerConfidence: "LOW",
  michiganSentiment: "LOW",
  michiganInflationExpectations: "MEDIUM",
  housingData: "LOW",
  tradeBalance: "LOW",
  productivity: "LOW",
  unitLaborCosts: "LOW",
};

// Checked in array order — more specific patterns (e.g. "core cpi") are
// listed before the generic ones they'd otherwise be swallowed by ("cpi")
// so a Core CPI release is never misclassified as headline CPI.
const PATTERNS: { key: EconomicIndicatorKey; patterns: string[] }[] = [
  { key: "corePce", patterns: ["core pce"] },
  { key: "pce", patterns: ["pce price index", "personal consumption expenditures", " pce "] },
  { key: "corePpi", patterns: ["core ppi"] },
  { key: "ppi", patterns: ["ppi", "producer price index"] },
  { key: "coreCpi", patterns: ["core cpi"] },
  { key: "cpi", patterns: ["cpi", "consumer price index"] },
  // michiganInflationExpectations must be checked before the generic
  // inflationExpectations pattern below — both match "inflation
  // expectations", same core-vs-headline priority-ordering concern.
  { key: "michiganInflationExpectations", patterns: ["michigan inflation expectations", "uom inflation expectations"] },
  { key: "inflationExpectations", patterns: ["inflation expectations"] },

  { key: "nfp", patterns: ["non-farm payrolls", "nonfarm payrolls", "nfp"] },
  { key: "adpEmployment", patterns: ["adp"] },
  { key: "avgHourlyEarnings", patterns: ["average hourly earnings"] },
  { key: "continuingClaims", patterns: ["continuing jobless claims", "continuing claims"] },
  { key: "joblessClaims", patterns: ["initial jobless claims", "jobless claims"] },
  { key: "jolts", patterns: ["jolts"] },
  { key: "unemploymentRate", patterns: ["unemployment rate"] },

  { key: "gdpRevision", patterns: ["gdp revision", "gdp (revised)"] },
  { key: "gdp", patterns: ["gdp"] },
  { key: "retailSales", patterns: ["retail sales"] },
  { key: "industrialProduction", patterns: ["industrial production"] },
  { key: "durableGoods", patterns: ["durable goods"] },
  { key: "ismManufacturing", patterns: ["ism manufacturing"] },
  { key: "ismServices", patterns: ["ism services", "ism non-manufacturing"] },
  // "markit" was S&P Global's PMI brand before the 2024 HCOB (eurozone) /
  // au Jibun Bank (Japan) rebrand of the underlying same survey — both
  // names must resolve to the same indicator so a real HCOB/Jibun Bank
  // release classifies instead of silently going unclassified.
  { key: "spGlobalManufacturingPmi", patterns: ["s&p global manufacturing pmi", "markit manufacturing pmi", "hcob manufacturing pmi", "jibun bank manufacturing pmi"] },
  { key: "spGlobalServicesPmi", patterns: ["s&p global services pmi", "markit services pmi", "hcob services pmi", "jibun bank services pmi"] },

  { key: "dotPlot", patterns: ["dot plot", "economic projections", "sep "] },
  { key: "powellPressConference", patterns: ["powell", "press conference"] },
  { key: "fomcMinutes", patterns: ["fomc minutes", "meeting minutes"] },
  { key: "fomcStatement", patterns: ["fomc statement"] },
  { key: "fedRateDecision", patterns: ["fed interest rate", "federal funds rate", "fomc rate decision"] },
  { key: "ecbRateDecision", patterns: ["ecb interest rate", "ecb rate decision", "ecb deposit facility"] },
  { key: "boeRateDecision", patterns: ["boe interest rate", "boe rate decision", "bank of england rate"] },
  { key: "bojRateDecision", patterns: ["boj interest rate", "boj rate decision", "bank of japan rate"] },
  { key: "snbRateDecision", patterns: ["snb interest rate", "snb rate decision"] },
  { key: "bocRateDecision", patterns: ["boc interest rate", "boc rate decision", "bank of canada rate"] },
  { key: "rbaRateDecision", patterns: ["rba interest rate", "rba rate decision"] },
  { key: "rbnzRateDecision", patterns: ["rbnz interest rate", "rbnz rate decision"] },

  { key: "michiganSentiment", patterns: ["michigan consumer sentiment", "uom consumer sentiment"] },
  { key: "consumerConfidence", patterns: ["consumer confidence"] },
  { key: "housingData", patterns: ["housing starts", "building permits", "existing home sales", "new home sales", "pending home sales"] },
  { key: "tradeBalance", patterns: ["trade balance"] },
  { key: "productivity", patterns: ["nonfarm productivity", "productivity"] },
  { key: "unitLaborCosts", patterns: ["unit labor costs"] },
];

/** Classifies a calendar provider's free-text event name into our
 * canonical taxonomy. Returns null (never a guess) when nothing matches. */
export function matchIndicator(rawEventName: string): EconomicIndicatorKey | null {
  const normalized = rawEventName.toLowerCase();
  for (const { key, patterns } of PATTERNS) {
    if (patterns.some((p) => normalized.includes(p))) return key;
  }
  return null;
}

export function importanceTierFor(key: EconomicIndicatorKey): ImportanceTier {
  return IMPORTANCE_TIER[key];
}

export type IndicatorCategory = "inflation" | "growthLabor" | "rateDecision" | "other";

// Shared by gold.ts (surprise-shock scaling) and engine.ts (dispatching a
// detected surprise to the right asset-interpretation function and factor
// slot) — one categorization, not duplicated per consumer.
const CATEGORY: Record<EconomicIndicatorKey, IndicatorCategory> = {
  cpi: "inflation",
  coreCpi: "inflation",
  ppi: "inflation",
  corePpi: "inflation",
  pce: "inflation",
  corePce: "inflation",
  inflationExpectations: "inflation",
  michiganInflationExpectations: "inflation",
  nfp: "growthLabor",
  unemploymentRate: "growthLabor",
  avgHourlyEarnings: "growthLabor",
  joblessClaims: "growthLabor",
  continuingClaims: "growthLabor",
  jolts: "growthLabor",
  adpEmployment: "growthLabor",
  gdp: "growthLabor",
  gdpRevision: "growthLabor",
  retailSales: "growthLabor",
  industrialProduction: "growthLabor",
  durableGoods: "growthLabor",
  ismManufacturing: "growthLabor",
  ismServices: "growthLabor",
  spGlobalManufacturingPmi: "growthLabor",
  spGlobalServicesPmi: "growthLabor",
  fedRateDecision: "rateDecision",
  fomcStatement: "other",
  dotPlot: "other",
  powellPressConference: "other",
  fomcMinutes: "other",
  ecbRateDecision: "rateDecision",
  boeRateDecision: "rateDecision",
  bojRateDecision: "rateDecision",
  snbRateDecision: "rateDecision",
  bocRateDecision: "rateDecision",
  rbaRateDecision: "rateDecision",
  rbnzRateDecision: "rateDecision",
  consumerConfidence: "other",
  michiganSentiment: "other",
  housingData: "other",
  tradeBalance: "other",
  productivity: "other",
  unitLaborCosts: "other",
};

export function indicatorCategory(key: EconomicIndicatorKey): IndicatorCategory {
  return CATEGORY[key];
}
