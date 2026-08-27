// Economic Heatmap (Phase 6 of the platform redesign) — 8 tracked
// currencies × 5 macro factors (Growth/Inflation/Labor/Rates/Surprise),
// each cell banded into a 5-tier Strong bullish..Strong bearish label.
// Every cell reuses an already-verified building block: growth/inflation/
// labor from fetchCountryScores (macro.ts), rates from a cross-sectional
// z-score of fetchLatestRates (the same "a rate only means something
// relative to the others" convention economic-strength.ts's rate
// component already established), surprise from economic-strength.ts's
// surpriseRollupFor. No new fetching, no new math beyond banding.
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { fetchCountryScores, fetchLatestRates, GROWTH_INDICATORS, INFLATION_INDICATORS, LABOR_INDICATORS } from "./macro";
import { surpriseRollupFor } from "./economic-strength";
import { getRecentSurprisesForCountries } from "@/db/queries/economic-releases";

export type HeatmapLabel = "Strong bullish" | "Bullish" | "Neutral" | "Bearish" | "Strong bearish";

export type HeatmapCell = { value: number | null; label: HeatmapLabel | null };

export const HEATMAP_FACTORS = ["Growth", "Inflation", "Labor", "Rates", "Surprise"] as const;
export type HeatmapFactor = (typeof HEATMAP_FACTORS)[number];

export type HeatmapRow = { factor: HeatmapFactor; cells: Record<string, HeatmapCell> };

export type EconomicHeatmapData = { currencies: string[]; rows: HeatmapRow[] };

const HEATMAP_INDICATORS = [...GROWTH_INDICATORS, ...INFLATION_INDICATORS, ...LABOR_INDICATORS];
const SURPRISE_LOOKBACK_HOURS = 24 * 14;

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length);
}

function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

export function bandHeatmapValue(value: number): HeatmapLabel {
  if (value >= 4) return "Strong bullish";
  if (value >= 1) return "Bullish";
  if (value > -1) return "Neutral";
  if (value > -4) return "Bearish";
  return "Strong bearish";
}

function cellFor(value: number | null): HeatmapCell {
  return { value: value !== null ? Number(value.toFixed(2)) : null, label: value !== null ? bandHeatmapValue(value) : null };
}

export async function buildEconomicHeatmap(storageOnly = true): Promise<EconomicHeatmapData> {
  const currencies = Object.keys(CCY_TO_COUNTRY);
  const countries = currencies.map((c) => CCY_TO_COUNTRY[c]);

  const [macroScores, rateReads, surpriseRows] = await Promise.all([
    Promise.all(countries.map((country) => fetchCountryScores(country, HEATMAP_INDICATORS, storageOnly))),
    Promise.all(countries.map((country) => fetchLatestRates(country, storageOnly))),
    getRecentSurprisesForCountries(countries, SURPRISE_LOOKBACK_HOURS),
  ]);

  const availableRates = rateReads.map((r) => r.policyRate).filter((v): v is number => v !== null);
  const rateMean = availableRates.length > 0 ? mean(availableRates) : 0;
  const rateStd = stdDev(availableRates, rateMean);

  const growthCells: Record<string, HeatmapCell> = {};
  const inflationCells: Record<string, HeatmapCell> = {};
  const laborCells: Record<string, HeatmapCell> = {};
  const rateCells: Record<string, HeatmapCell> = {};
  const surpriseCells: Record<string, HeatmapCell> = {};

  currencies.forEach((currency, i) => {
    const country = countries[i];
    const macro = macroScores[i];
    const rate = rateReads[i];

    growthCells[currency] = cellFor(macro.growthScore);
    inflationCells[currency] = cellFor(macro.inflationScore);
    laborCells[currency] = cellFor(macro.laborScore);

    const rateValue = rate.policyRate !== null && rateStd > 1e-9 ? clamp(((rate.policyRate - rateMean) / rateStd) * 4) : rate.policyRate !== null ? 0 : null;
    rateCells[currency] = cellFor(rateValue);

    surpriseCells[currency] = cellFor(surpriseRollupFor(country, surpriseRows));
  });

  return {
    currencies,
    rows: [
      { factor: "Growth", cells: growthCells },
      { factor: "Inflation", cells: inflationCells },
      { factor: "Labor", cells: laborCells },
      { factor: "Rates", cells: rateCells },
      { factor: "Surprise", cells: surpriseCells },
    ],
  };
}
