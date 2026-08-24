// Gold-specific macro composite ("goldMacroRegime"). Gold has no home-market
// economy and does not respond to growth/inflation the way equities or FX
// do — simply inverting the generic country-growth-differential model (as
// the old code implicitly did by treating positive growth as bullish for
// every non-FX asset) would still be economically wrong, because gold's
// price is dominated by a different, narrower set of drivers entirely:
//   - the opportunity cost of holding a non-yielding asset (real yields)
//   - the currency it's priced in (broad USD strength)
//   - the inflation-hedge motive, net of that same opportunity cost
//     (breakeven inflation expectations, offset by real yields)
//   - near-term Fed policy expectations (the market's own forward-looking
//     read via the 2Y yield, not just where policy already sits)
//   - safe-haven demand during risk-off episodes (VIX)
// This module is the single place that composite lives. macro.ts's
// resolveInflationFactor and resolveInterestRatesFactor delegate to it for
// XAUUSD instead of running their generic country/policy-rate models —
// every other independent factor (technical trend, seasonality, CFTC
// positioning, news, retail sentiment) is untouched and keeps flowing
// through its own resolver exactly as before.
//
// Scoped to XAUUSD only for now, per spec ("starting with XAUUSD"). Silver
// and Platinum share Gold's growth/labor polarity flip (see
// asset-polarity.ts) but keep the generic FRED inflation/interest-rate
// model here — both carry meaningful industrial-demand exposure a
// pure-monetary-metal composite would misrepresent, and extending this
// composite to them needs its own real-data validation, not a blanket
// assumption.
import { getInstrument } from "@/lib/instruments";
import { inflationFactorFor as demoInflationFactor, interestRateFactor as demoInterestRateFactor } from "@/lib/scoring";
import { getFredSeriesWithFallback } from "@/services/market-data/last-known-good";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { FredSeriesPoint } from "@/services/types";
import { DataFreshness, ScoreFactorKey } from "@/lib/types";
import { DataMode, allowsDemoFallback } from "@/services/data-mode";
import { demoFallbackFactor, ResolvedFactor, unavailableFactor, worseOf } from "./types";

export const GOLD_SYMBOL = "XAUUSD";

const GOLD_MACRO_SOURCE = "FRED (real yields, USD, breakeven inflation, VIX)";

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

// ~60 daily observations (~3 calendar months of trading days) — a window
// long enough to capture a genuine regime shift (e.g. a real-yield repricing
// cycle) rather than single-day noise, short enough to stay responsive.
const LOOKBACK_OBSERVATIONS = 60;

// Exported so a standalone backtest script (scripts/backtest-gold-macro.ts)
// can drive the exact same composite math against real historical FRED
// windows instead of "now" — see scoreGoldMacroRegime below, the pure
// function this type feeds. Keeping the math in one place means a backtest
// can never silently drift from what the live pipeline actually computes.
export type GoldMacroSeriesRead = { points: FredSeriesPoint[] | null; freshness: DataFreshness };

async function readSeries(indicator: FredIndicatorKey, lookback: number, storageOnly: boolean): Promise<GoldMacroSeriesRead> {
  const result = await getFredSeriesWithFallback("US", indicator, lookback, storageOnly);
  const usable = (result.status === "live" || result.status === "delayed" || result.status === "stale") && !!result.value && result.value.length >= 2;
  return { points: usable ? result.value : null, freshness: usable ? result.status : "unavailable" };
}

// Genuine directional magnitude (in the series' own natural units —
// percentage points for yields, index points for USD/VIX) between the
// oldest and newest observation in the window, not just a sign flag, so the
// composite (and a backtest against real forward returns) can distinguish a
// small drift from a sharp move.
function change(points: FredSeriesPoint[]): number {
  return points[points.length - 1].value - points[0].value;
}

export type GoldMacroDriver = { label: string; changeValue: number; contribution: number; explanation: string };

export type GoldMacroRegime = {
  interestRatesRaw: number;
  interestRatesExplanation: string;
  interestRatesFreshness: DataFreshness; // "unavailable" when none of real-yield/USD/2Y-yield/VIX resolved
  inflationRaw: number;
  inflationExplanation: string;
  inflationFreshness: DataFreshness; // "unavailable" when breakeven inflation didn't resolve
  drivers: GoldMacroDriver[];
};

// Dominance weights: real yields and USD are deliberately the largest
// multipliers ("real yields and USD are the dominant drivers" per spec).
// Fed-cut expectations and safe-haven demand contribute meaningfully but
// secondarily; breakeven inflation is its own (inflation-factor) driver.
// All scaled so a typical multi-month move lands within the shared -10..10
// rawScore range every other factor uses, then clamped the same way.
const WEIGHTS = {
  realYield: 6.5, // points per 1.0pt move in DFII10 (10Y real/TIPS yield)
  usd: 0.9, // points per 1.0 index-point move in DTWEXBGS (broad USD index)
  fedCut: 3.0, // points per 1.0pt move in DGS2 (2Y yield, cut-expectations proxy)
  safeHaven: 0.35, // points per 1.0pt move in VIXCLS
  breakeven: 4.5, // points per 1.0pt move in T10YIE (10Y breakeven inflation)
};

// When real yields rose over the same window, a chunk of any breakeven-
// inflation rise is really "nominal yields rose even faster" rather than a
// clean inflation-hedge bid — the inflation contribution is dampened, not
// zeroed, in that case (per spec: "bullish when not offset by higher real
// yields").
const REAL_YIELD_OFFSET_DAMPENING = 0.4;

export type GoldMacroSeriesInput = {
  realYield: GoldMacroSeriesRead;
  usd: GoldMacroSeriesRead;
  fedCut: GoldMacroSeriesRead;
  safeHaven: GoldMacroSeriesRead;
  breakeven: GoldMacroSeriesRead;
};

export async function computeGoldMacroRegime(lookback = LOOKBACK_OBSERVATIONS, storageOnly = false): Promise<GoldMacroRegime> {
  const [realYield, usd, fedCut, safeHaven, breakeven] = await Promise.all([
    readSeries("realYield10y", lookback, storageOnly),
    readSeries("usdIndexBroad", lookback, storageOnly),
    readSeries("yield2y", lookback, storageOnly),
    readSeries("vix", lookback, storageOnly),
    readSeries("breakevenInflation10y", lookback, storageOnly),
  ]);

  return scoreGoldMacroRegime({ realYield, usd, fedCut, safeHaven, breakeven });
}

// Pure — no fetching, no I/O. This is the actual composite math (the same
// math computeGoldMacroRegime above uses against "now") factored out so
// scripts/backtest-gold-macro.ts can call it against a real historical
// window ending at any past date, guaranteeing the backtest can never
// silently diverge from what the live pipeline computes today.
export function scoreGoldMacroRegime({ realYield, usd, fedCut, safeHaven, breakeven }: GoldMacroSeriesInput): GoldMacroRegime {
  const drivers: GoldMacroDriver[] = [];
  const rateDriverExplanations: string[] = [];

  let realYieldChange: number | null = null;
  let realYieldContribution = 0;
  let ratesFreshness: DataFreshness | null = null;
  if (realYield.points) {
    realYieldChange = change(realYield.points);
    // Rising real yields raise the opportunity cost of holding non-yielding
    // gold -> bearish; falling real yields lower it -> strongly bullish.
    realYieldContribution = clamp(-realYieldChange * WEIGHTS.realYield);
    const explanation = `10Y real (TIPS) yield ${realYieldChange >= 0 ? "rose" : "fell"} ${Math.abs(realYieldChange).toFixed(2)}pt — ${realYieldContribution < 0 ? "bearish" : realYieldContribution > 0 ? "bullish" : "neutral"} for a non-yielding asset like gold.`;
    drivers.push({ label: "Real 10Y yield (DFII10)", changeValue: realYieldChange, contribution: realYieldContribution, explanation });
    rateDriverExplanations.push(explanation);
    ratesFreshness = worseOf(ratesFreshness ?? realYield.freshness, realYield.freshness);
  }

  let usdChange: number | null = null;
  let usdContribution = 0;
  if (usd.points) {
    usdChange = change(usd.points);
    // A stronger dollar makes dollar-priced gold more expensive for holders
    // of other currencies -> bearish; a weaker dollar -> bullish.
    usdContribution = clamp(-usdChange * WEIGHTS.usd);
    const explanation = `Broad USD index ${usdChange >= 0 ? "strengthened" : "weakened"} ${Math.abs(usdChange).toFixed(2)} points — ${usdContribution < 0 ? "bearish" : usdContribution > 0 ? "bullish" : "neutral"} for gold.`;
    drivers.push({ label: "Broad USD index (DTWEXBGS)", changeValue: usdChange, contribution: usdContribution, explanation });
    rateDriverExplanations.push(explanation);
    ratesFreshness = worseOf(ratesFreshness ?? usd.freshness, usd.freshness);
  }

  let fedCutChange: number | null = null;
  let fedCutContribution = 0;
  if (fedCut.points) {
    fedCutChange = change(fedCut.points);
    // The 2Y Treasury yield is the market's own forward-looking read on the
    // path of Fed policy — it falls when traders price in more/faster cuts
    // and rises when they price in a more hawkish path. Falling 2Y yield ->
    // rising cut expectations -> bullish for non-yielding gold.
    fedCutContribution = clamp(-fedCutChange * WEIGHTS.fedCut);
    const explanation = `2Y Treasury yield ${fedCutChange >= 0 ? "rose" : "fell"} ${Math.abs(fedCutChange).toFixed(2)}pt — the market is pricing ${fedCutChange < 0 ? "more" : "less"} Fed easing than at the start of the window, ${fedCutContribution > 0 ? "bullish" : fedCutContribution < 0 ? "bearish" : "neutral"} for gold.`;
    drivers.push({ label: "2Y yield / Fed-cut expectations (DGS2)", changeValue: fedCutChange, contribution: fedCutContribution, explanation });
    rateDriverExplanations.push(explanation);
    ratesFreshness = worseOf(ratesFreshness ?? fedCut.freshness, fedCut.freshness);
  }

  let safeHavenChange: number | null = null;
  let safeHavenContribution = 0;
  if (safeHaven.points) {
    safeHavenChange = change(safeHaven.points);
    // Rising VIX signals rising risk-off conditions -> moderately bullish
    // for gold's safe-haven demand; falling VIX -> a mild headwind.
    safeHavenContribution = clamp(safeHavenChange * WEIGHTS.safeHaven);
    const explanation = `VIX ${safeHavenChange >= 0 ? "rose" : "fell"} ${Math.abs(safeHavenChange).toFixed(1)} points — ${safeHavenContribution > 0 ? "increasing risk-off conditions, moderately bullish" : "easing risk-off conditions, a mild headwind"} for gold's safe-haven demand.`;
    drivers.push({ label: "VIX / risk-off proxy (VIXCLS)", changeValue: safeHavenChange, contribution: safeHavenContribution, explanation });
    rateDriverExplanations.push(explanation);
    ratesFreshness = worseOf(ratesFreshness ?? safeHaven.freshness, safeHaven.freshness);
  }

  let breakevenChange: number | null = null;
  let breakevenContribution = 0;
  let breakevenExplanation: string | null = null;
  let inflationFreshness: DataFreshness | null = null;
  if (breakeven.points) {
    breakevenChange = change(breakeven.points);
    // Rising inflation expectations support gold as an inflation hedge —
    // but real yield = nominal yield minus breakeven inflation, so a
    // real-yield rise alongside a breakeven rise means nominal yields rose
    // even faster: gold's own opportunity-cost headwind dominates in that
    // case, so the inflation contribution is dampened (not zeroed) rather
    // than treating the two as independent.
    const dampen = realYieldChange !== null && realYieldChange > 0 ? REAL_YIELD_OFFSET_DAMPENING : 1;
    breakevenContribution = clamp(breakevenChange * WEIGHTS.breakeven * dampen);
    breakevenExplanation = `10Y breakeven inflation ${breakevenChange >= 0 ? "rose" : "fell"} ${Math.abs(breakevenChange).toFixed(2)}pt${dampen < 1 ? ", partially offset by rising real yields over the same window" : ""} — ${breakevenContribution > 0 ? "bullish" : breakevenContribution < 0 ? "bearish" : "neutral"} for gold as an inflation hedge.`;
    drivers.push({ label: "10Y breakeven inflation (T10YIE)", changeValue: breakevenChange, contribution: breakevenContribution, explanation: breakevenExplanation });
    inflationFreshness = breakeven.freshness;
  }

  const interestRatesRaw = clamp(realYieldContribution + usdContribution + fedCutContribution + safeHavenContribution);
  const interestRatesExplanation =
    rateDriverExplanations.length > 0
      ? `Gold-specific macro regime (real yields & USD dominant): ${rateDriverExplanations.join(" ")}`
      : "Data temporarily unavailable: no gold-macro-regime series (real yield, USD, 2Y yield, VIX) resolved.";

  const inflationRaw = clamp(breakevenContribution);
  const inflationExplanation = breakevenExplanation ? `Gold inflation-hedge read: ${breakevenExplanation}` : "Data temporarily unavailable: 10Y breakeven inflation (T10YIE) series did not resolve.";

  return {
    interestRatesRaw,
    interestRatesExplanation,
    interestRatesFreshness: ratesFreshness ?? "unavailable",
    inflationRaw,
    inflationExplanation,
    inflationFreshness: inflationFreshness ?? "unavailable",
    drivers,
  };
}

function goldDemoFallback(key: ScoreFactorKey): ResolvedFactor {
  const instrument = getInstrument(GOLD_SYMBOL)!;
  // Both of these demo functions already model gold correctly (see
  // lib/scoring.ts's inflationFactorFor real-yield-proxy branch for XAUUSD/
  // XAGUSD/XPTUSD, and interestRateFactor's generic hawkish(-)/dovish(+)
  // stance sign, which is directionally right for gold too) — reused as-is,
  // not reimplemented, so the demo fallback never drifts from the demo
  // generator's own gold model.
  const result = key === "inflation" ? demoInflationFactor(instrument) : demoInterestRateFactor(instrument);
  const source = key === "inflation" ? "CPI / PPI / real-yield composite (demo)" : "Central bank policy & yield curves (demo)";
  return demoFallbackFactor({ key, rawScore: result.raw, explanation: result.explanation, source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
}

export async function resolveGoldInflationFactor(mode: DataMode, storageOnly = false): Promise<ResolvedFactor> {
  const regime = await computeGoldMacroRegime(LOOKBACK_OBSERVATIONS, storageOnly);
  if (regime.inflationFreshness === "unavailable") {
    return allowsDemoFallback(mode, GOLD_SYMBOL)
      ? goldDemoFallback("inflation")
      : unavailableFactor("inflation", GOLD_MACRO_SOURCE, "10Y breakeven inflation (T10YIE) series did not resolve for gold's macro composite");
  }
  const now = new Date().toISOString();
  return {
    key: "inflation",
    rawScore: regime.inflationRaw,
    explanation: regime.inflationExplanation,
    source: GOLD_MACRO_SOURCE,
    provider: "fred",
    freshness: regime.inflationFreshness,
    lastUpdated: now,
    nextUpdate: now,
  };
}

export async function resolveGoldInterestRatesFactor(mode: DataMode, storageOnly = false): Promise<ResolvedFactor> {
  const regime = await computeGoldMacroRegime(LOOKBACK_OBSERVATIONS, storageOnly);
  if (regime.interestRatesFreshness === "unavailable") {
    return allowsDemoFallback(mode, GOLD_SYMBOL)
      ? goldDemoFallback("interestRates")
      : unavailableFactor("interestRates", GOLD_MACRO_SOURCE, "None of real yield (DFII10), USD index (DTWEXBGS), 2Y yield (DGS2), or VIX resolved for gold's macro composite");
  }
  const now = new Date().toISOString();
  return {
    key: "interestRates",
    rawScore: regime.interestRatesRaw,
    explanation: regime.interestRatesExplanation,
    source: GOLD_MACRO_SOURCE,
    provider: "fred",
    freshness: regime.interestRatesFreshness,
    lastUpdated: now,
    nextUpdate: now,
  };
}
