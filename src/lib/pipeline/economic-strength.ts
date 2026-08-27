// Economic Strength Index (Phase 4 of the platform redesign) — a
// per-currency composite (-100..100) combining growth, labor, relative
// policy-rate positioning, and recent economic-surprise momentum for each
// of the 8 currencies this platform tracks (CCY_TO_COUNTRY's exact set:
// USD/EUR/GBP/JPY/AUD/NZD/CAD/CHF). This is new, original methodology —
// no equivalent composite exists elsewhere in the codebase — built
// entirely from already-verified building blocks:
//   - growth/labor: fetchCountryScores (lib/pipeline/macro.ts), the same
//     FRED-driven per-country scorer the Scorecard's FX macro factors use.
//   - policy rate: fetchLatestRates (macro.ts), ranked cross-sectionally
//     across the 8 tracked currencies (a rate only means something
//     relative to the others — there's no absolute "good" policy rate).
//   - recent surprise momentum: getRecentSurprisesForCountries
//     (db/queries/economic-releases.ts), the same surpriseZ the V2
//     surprise engine already computes and stores. Per fx.ts's existing
//     computeFxRelativeSurpriseShockOneSided convention, a country's own
//     raw surpriseZ sign is treated as directly currency-directional
//     (positive = that release was good news for that country's
//     currency) — this mirrors the V2 architecture's own established
//     convention rather than introducing a second, different one here.
//
// Never fabricates a score: a currency with zero available components
// (no FRED coverage at all, no rate series, no recent releases) comes
// back with score: null, freshness: "unavailable" — never a guessed
// number.
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { fetchCountryScores, fetchLatestRates, GROWTH_INDICATORS, LABOR_INDICATORS } from "./macro";
import { getRecentSurprisesForCountries, RecentSurpriseRow } from "@/db/queries/economic-releases";
import { ImportanceTier } from "@/lib/scoring-v2/config";
import { DataFreshness } from "@/lib/types";
import { StrengthLevel, strengthLevelForScore } from "@/lib/format";

export type StrengthDriver = { label: string; contribution: number; explanation: string };

export type CurrencyStrength = {
  currency: string;
  country: string;
  score: number | null; // -100..100, null when no component has any data
  level: StrengthLevel | null;
  drivers: StrengthDriver[];
  freshness: DataFreshness;
};

const STRENGTH_INDICATORS = [...GROWTH_INDICATORS, ...LABOR_INDICATORS];
const SURPRISE_LOOKBACK_HOURS = 24 * 14; // 2 weeks — recent-momentum window, not a long-run average

const IMPORTANCE_WEIGHT: Record<ImportanceTier, number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };

// Each raw component is scaled to a common -10..10 range before weighting,
// mirroring every other factor in this codebase's convention (scoring.ts,
// macro.ts), then the weighted sum is scaled ×10 into the -100..100
// composite range the "USD +72" style display calls for.
const WEIGHTS = { growth: 0.3, labor: 0.25, rate: 0.25, surprise: 0.2 };

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function worseFreshness(a: DataFreshness, b: DataFreshness): DataFreshness {
  const severity: Partial<Record<DataFreshness, number>> = { live: 0, delayed: 1, stale: 2, estimated: 3, unavailable: 4, error: 4, not_applicable: 4 };
  return (severity[b] ?? 0) > (severity[a] ?? 0) ? b : a;
}

function surpriseRollupFor(country: string, rows: RecentSurpriseRow[]): number | null {
  const matching = rows.filter((r) => r.country === country && r.surpriseZ !== null);
  if (matching.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const r of matching) {
    const w = IMPORTANCE_WEIGHT[r.importanceTier];
    weightedSum += (r.surpriseZ as number) * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return null;
  // surpriseZ is clamped to [-4, 4] (economic-surprise.ts's MAX_ABS_Z) —
  // ×2.5 maps that onto this module's common -10..10 component range.
  return clamp((weightedSum / weightTotal) * 2.5);
}

/** Computes all 8 tracked currencies together (not one at a time) because
 * the rate component is a cross-sectional rank — a 5% policy rate only
 * signals "hawkish" relative to the other 7 currencies' rates this
 * moment, not against some fixed absolute threshold. */
export async function computeAllCurrencyStrengths(storageOnly = true): Promise<CurrencyStrength[]> {
  const currencies = Object.keys(CCY_TO_COUNTRY);
  const countries = currencies.map((c) => CCY_TO_COUNTRY[c]);

  const [macroScores, rateReads, surpriseRows] = await Promise.all([
    Promise.all(countries.map((country) => fetchCountryScores(country, STRENGTH_INDICATORS, storageOnly))),
    Promise.all(countries.map((country) => fetchLatestRates(country, storageOnly))),
    getRecentSurprisesForCountries(countries, SURPRISE_LOOKBACK_HOURS),
  ]);

  const availableRates = rateReads.map((r) => r.policyRate).filter((v): v is number => v !== null);
  const rateMean = availableRates.length > 0 ? mean(availableRates) : 0;
  const rateStd = stdDev(availableRates, rateMean);

  return currencies.map((currency, i) => {
    const country = countries[i];
    const macro = macroScores[i];
    const rate = rateReads[i];
    const drivers: StrengthDriver[] = [];
    let weightedSum = 0;
    let weightTotal = 0;
    let freshness: DataFreshness = "live";
    let anyComponent = false;

    if (macro.growthScore !== null) {
      anyComponent = true;
      weightedSum += macro.growthScore * WEIGHTS.growth;
      weightTotal += WEIGHTS.growth;
      freshness = worseFreshness(freshness, macro.freshness ?? "live");
      drivers.push({
        label: "Economic growth",
        contribution: Number((macro.growthScore * WEIGHTS.growth * 10).toFixed(1)),
        explanation: `${country} growth score ${macro.growthScore > 0 ? "+" : ""}${macro.growthScore.toFixed(1)} from real GDP/industrial production/retail sales (FRED).`,
      });
    }

    if (macro.laborScore !== null) {
      anyComponent = true;
      weightedSum += macro.laborScore * WEIGHTS.labor;
      weightTotal += WEIGHTS.labor;
      freshness = worseFreshness(freshness, macro.freshness ?? "live");
      drivers.push({
        label: "Labor market",
        contribution: Number((macro.laborScore * WEIGHTS.labor * 10).toFixed(1)),
        explanation: `${country} labor score ${macro.laborScore > 0 ? "+" : ""}${macro.laborScore.toFixed(1)} from unemployment/payrolls/claims/wage growth (FRED).`,
      });
    }

    if (rate.policyRate !== null) {
      anyComponent = true;
      const rateZ = rateStd > 1e-9 ? clamp(((rate.policyRate - rateMean) / rateStd) * 4) : 0;
      weightedSum += rateZ * WEIGHTS.rate;
      weightTotal += WEIGHTS.rate;
      freshness = worseFreshness(freshness, rate.freshness);
      drivers.push({
        label: "Relative policy rate",
        contribution: Number((rateZ * WEIGHTS.rate * 10).toFixed(1)),
        explanation: `${country} policy rate ${rate.policyRate}% — ${rateZ > 0.3 ? "above" : rateZ < -0.3 ? "below" : "in line with"} the average across the ${currencies.length} tracked currencies (FRED).`,
      });
    }

    const surpriseRollup = surpriseRollupFor(country, surpriseRows);
    if (surpriseRollup !== null) {
      anyComponent = true;
      weightedSum += surpriseRollup * WEIGHTS.surprise;
      weightTotal += WEIGHTS.surprise;
      drivers.push({
        label: "Recent economic surprises",
        contribution: Number((surpriseRollup * WEIGHTS.surprise * 10).toFixed(1)),
        explanation: `${country} releases over the last 2 weeks came in ${surpriseRollup > 0 ? "stronger" : surpriseRollup < 0 ? "weaker" : "in line with"} consensus on an importance-weighted basis.`,
      });
    }

    if (!anyComponent) {
      return { currency, country, score: null, level: null, drivers: [], freshness: "unavailable" as DataFreshness };
    }

    // Renormalize by the weight actually available — a currency with only
    // growth+labor data still gets a real (if less complete) score rather
    // than being silently penalized for factors this platform simply
    // doesn't have coverage for yet.
    const composite = clamp((weightedSum / weightTotal) * 10, -100, 100);
    const score = Number(composite.toFixed(1));

    return { currency, country, score, level: strengthLevelForScore(score), drivers, freshness };
  });
}

export async function computeCurrencyStrength(currency: string, storageOnly = true): Promise<CurrencyStrength> {
  const all = await computeAllCurrencyStrengths(storageOnly);
  const found = all.find((c) => c.currency === currency.toUpperCase());
  if (!found) throw new Error(`${currency} is not one of the tracked currencies (${Object.keys(CCY_TO_COUNTRY).join(", ")}).`);
  return found;
}
