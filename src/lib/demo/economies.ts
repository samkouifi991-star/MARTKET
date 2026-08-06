import { EconomicRelease } from "../types";
import { Rng } from "../rng";
import { daysAgo, isoOffset } from "../time";
import { countryCycle } from "./cycle";

export type Country = { code: string; name: string; currency: string };

export const COUNTRIES: Country[] = [
  { code: "US", name: "United States", currency: "USD" },
  { code: "EU", name: "Eurozone", currency: "EUR" },
  { code: "GB", name: "United Kingdom", currency: "GBP" },
  { code: "JP", name: "Japan", currency: "JPY" },
  { code: "CH", name: "Switzerland", currency: "CHF" },
  { code: "AU", name: "Australia", currency: "AUD" },
  { code: "NZ", name: "New Zealand", currency: "NZD" },
  { code: "CA", name: "Canada", currency: "CAD" },
];

type IndicatorSpec = {
  key: string;
  indicator: string;
  unit: string;
  base: number;
  volatility: number;
  higherIsBetter: boolean; // for trend labeling
  releaseDaysAgo: number;
  cadenceDays: number;
  markets: string[];
};

function buildRelease(
  rng: Rng,
  country: Country,
  spec: IndicatorSpec,
  cycle: number
): EconomicRelease {
  // The cycle nudges actuals (not the consensus forecast) so this indicator's
  // surprise leans the same direction as the rest of the country's data,
  // in the direction that's economically favorable for its own polarity.
  const cycleNudge = cycle * spec.volatility * (spec.higherIsBetter ? 0.5 : -0.5);
  const previous = spec.base + rng.float(-spec.volatility, spec.volatility);
  const forecast = previous + rng.float(-spec.volatility * 0.4, spec.volatility * 0.4);
  const actual = forecast + rng.float(-spec.volatility * 0.5, spec.volatility * 0.5) + cycleNudge;
  const revision = rng.bool(0.35) ? Number((rng.float(-spec.volatility * 0.2, spec.volatility * 0.2)).toFixed(2)) : null;
  const surprise = Number((actual - forecast).toFixed(2));

  const history: { date: string; actual: number }[] = [];
  let walking = actual - cycleNudge * 3;
  for (let i = 11; i >= 0; i--) {
    walking += rng.float(-spec.volatility * 0.5, spec.volatility * 0.5) + cycleNudge * 0.25;
    history.push({ date: daysAgo(spec.releaseDaysAgo + i * spec.cadenceDays), actual: Number(walking.toFixed(2)) });
  }
  history[history.length - 1] = { date: daysAgo(spec.releaseDaysAgo), actual: Number(actual.toFixed(2)) };

  const trendOf = (span: number) => {
    const start = history[Math.max(0, history.length - 1 - span)].actual;
    const end = history[history.length - 1].actual;
    const delta = spec.higherIsBetter ? end - start : start - end;
    if (Math.abs(delta) < spec.volatility * 0.15) return "Stable" as const;
    return delta > 0 ? ("Improving" as const) : ("Deteriorating" as const);
  };

  return {
    id: `${country.code}-${spec.key}`,
    country: country.name,
    indicator: spec.indicator,
    previous: Number(previous.toFixed(2)),
    forecast: Number(forecast.toFixed(2)),
    actual: Number(actual.toFixed(2)),
    revision,
    surprise,
    higherIsBetter: spec.higherIsBetter,
    unit: spec.unit,
    releaseDate: daysAgo(spec.releaseDaysAgo),
    nextRelease: isoOffset((spec.cadenceDays - spec.releaseDaysAgo) * 24),
    impactedMarkets: spec.markets,
    history,
    trend3m: trendOf(3),
    trend6m: trendOf(6),
  };
}

export type CountryEconomy = {
  country: Country;
  growth: EconomicRelease[];
  inflation: EconomicRelease[];
  labor: EconomicRelease[];
  growthScore: number; // -10..10, positive = beating expectations / accelerating
  inflationScore: number; // -10..10, positive = inflation surprising to the upside
  inflationTrend: "Rising" | "Falling" | "Stable";
  laborScore: number; // -10..10
};

function surpriseScore(releases: EconomicRelease[]): number {
  if (releases.length === 0) return 0;
  const avg =
    releases.reduce((sum, r) => {
      const direction = r.higherIsBetter ? 1 : -1;
      return sum + direction * Math.sign(r.surprise) * Math.min(1, Math.abs(r.surprise) / 0.6);
    }, 0) / releases.length;
  return Number((avg * 10).toFixed(2));
}

function buildEconomy(country: Country): CountryEconomy {
  const rng = new Rng(`econ:${country.code}`);
  const cycle = countryCycle(country.code);
  const marketsFor = (extra: string[] = []) => [country.currency, ...extra];

  const growth = [
    buildRelease(rng, country, { key: "gdp", indicator: "GDP Growth QoQ", unit: "%", base: 1.8, volatility: 0.7, higherIsBetter: true, releaseDaysAgo: 12, cadenceDays: 90, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "pmi_mfg", indicator: "Manufacturing PMI", unit: "", base: 51, volatility: 3.5, higherIsBetter: true, releaseDaysAgo: 4, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "pmi_svc", indicator: "Services PMI", unit: "", base: 52, volatility: 3, higherIsBetter: true, releaseDaysAgo: 4, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "retail", indicator: "Retail Sales MoM", unit: "%", base: 0.3, volatility: 0.6, higherIsBetter: true, releaseDaysAgo: 8, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "confidence", indicator: "Consumer Confidence", unit: "", base: 98, volatility: 6, higherIsBetter: true, releaseDaysAgo: 6, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "indprod", indicator: "Industrial Production", unit: "%", base: 0.4, volatility: 0.9, higherIsBetter: true, releaseDaysAgo: 15, cadenceDays: 30, markets: marketsFor() }, cycle),
  ];

  const inflation = [
    buildRelease(rng, country, { key: "cpi", indicator: "CPI YoY", unit: "%", base: 3.1, volatility: 0.6, higherIsBetter: true, releaseDaysAgo: 5, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "core_cpi", indicator: "Core CPI YoY", unit: "%", base: 3.3, volatility: 0.5, higherIsBetter: true, releaseDaysAgo: 5, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "ppi", indicator: "PPI YoY", unit: "%", base: 2.4, volatility: 0.7, higherIsBetter: true, releaseDaysAgo: 9, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "wages", indicator: "Wage Growth YoY", unit: "%", base: 4.0, volatility: 0.6, higherIsBetter: true, releaseDaysAgo: 20, cadenceDays: 30, markets: marketsFor() }, cycle),
  ];

  const labor = [
    buildRelease(rng, country, { key: "employment", indicator: "Employment Change", unit: "k", base: 160, volatility: 90, higherIsBetter: true, releaseDaysAgo: 2, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "unemployment", indicator: "Unemployment Rate", unit: "%", base: 4.1, volatility: 0.3, higherIsBetter: false, releaseDaysAgo: 2, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "claims", indicator: "Initial Jobless Claims", unit: "k", base: 215, volatility: 25, higherIsBetter: false, releaseDaysAgo: 1, cadenceDays: 7, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "openings", indicator: "Job Openings", unit: "M", base: 8.1, volatility: 0.5, higherIsBetter: true, releaseDaysAgo: 10, cadenceDays: 30, markets: marketsFor() }, cycle),
    buildRelease(rng, country, { key: "participation", indicator: "Labor-Force Participation", unit: "%", base: 62.5, volatility: 0.3, higherIsBetter: true, releaseDaysAgo: 2, cadenceDays: 30, markets: marketsFor() }, cycle),
  ];

  const cpiTrend = inflation[0].trend3m;
  const inflationTrend: CountryEconomy["inflationTrend"] =
    cpiTrend === "Improving" ? "Rising" : cpiTrend === "Deteriorating" ? "Falling" : "Stable";

  return {
    country,
    growth,
    inflation,
    labor,
    growthScore: surpriseScore(growth),
    inflationScore: surpriseScore(inflation),
    inflationTrend,
    laborScore: surpriseScore(labor),
  };
}

const ECONOMIES = new Map<string, CountryEconomy>();
for (const c of COUNTRIES) ECONOMIES.set(c.code, buildEconomy(c));

export function getEconomy(code: string): CountryEconomy {
  const eco = ECONOMIES.get(code);
  if (!eco) throw new Error(`Unknown country code ${code}`);
  return eco;
}

export function allEconomies(): CountryEconomy[] {
  return COUNTRIES.map((c) => getEconomy(c.code));
}
