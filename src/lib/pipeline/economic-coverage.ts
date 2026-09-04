// Admin "Economic Data Coverage" diagnostic (see /admin/economic-coverage)
// — answers "what real macro data do we actually have, per currency, right
// now" so the admin knows exactly what to seed from Forex Factory next.
// Built directly from the SAME two tables the Scorecard itself reads
// (economic_events calendar releases, economic_indicators FRED macro
// state) via exactly 2 batched queries total, regardless of how many
// indicator/currency cells the grid has — see db/queries/market-data.ts's
// getEconomicEventCoverage/getEconomicIndicatorCoverage. No new provider
// calls: this reads what's already stored, never a live FRED/calendar
// fetch. Admin-only — never rendered on the customer-facing Scorecard.
import { CCY_TO_COUNTRY } from "@/lib/scoring";
import { EconomicIndicatorKey } from "@/services/economic-calendar/indicator-taxonomy";
import { FredIndicatorKey } from "@/services/market-data/fred-series";
import { classifyFredFreshness } from "@/services/market-data/fred";
import { getEconomicEventCoverage, getEconomicIndicatorCoverage } from "@/db/queries/market-data";
import { RATE_DECISION_BY_COUNTRY } from "./scorecard";

export type CoverageStatus = "current" | "stale" | "missing";
export type CoverageSource = "calendar" | "fred" | null;
export type CoverageCell = { status: CoverageStatus; latestDate: string | null; source: CoverageSource };

export const TRACKED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF"] as const;
export type TrackedCurrency = (typeof TRACKED_CURRENCIES)[number];

export type CoverageRow = { label: string; cells: Record<TrackedCurrency, CoverageCell> };

type CoverageDef = {
  label: string;
  // Fixed calendar keys, OR a per-country resolver for indicators whose
  // calendar key differs by country (only Policy Rate today — each central
  // bank has its own rate-decision indicatorKey).
  calendarKeys?: EconomicIndicatorKey[];
  calendarKeysByCountry?: (country: string) => EconomicIndicatorKey[];
  // Omitted where no verified FRED series exists for this concept at all
  // (Manufacturing/Services PMI, Consumer Confidence, ADP, JOLTS, Wage
  // Growth) — never guessed. NFP deliberately has none: FRED's "payrolls"
  // is a level, not the monthly change figure "NFP" means to traders.
  fredKey?: FredIndicatorKey;
};

const COVERAGE_INDICATORS: CoverageDef[] = [
  { label: "GDP Growth", calendarKeys: ["gdp"], fredKey: "gdpGrowth" },
  { label: "Manufacturing PMI", calendarKeys: ["ismManufacturing", "spGlobalManufacturingPmi"] },
  { label: "Services PMI", calendarKeys: ["ismServices", "spGlobalServicesPmi"] },
  { label: "Retail Sales", calendarKeys: ["retailSales"], fredKey: "retailSales" },
  { label: "Consumer Confidence", calendarKeys: ["consumerConfidence", "michiganSentiment"] },
  { label: "CPI", calendarKeys: ["cpi"], fredKey: "cpi" },
  { label: "Core CPI", calendarKeys: ["coreCpi"], fredKey: "coreCpi" },
  { label: "PPI", calendarKeys: ["ppi"], fredKey: "ppi" },
  { label: "PCE", calendarKeys: ["pce"], fredKey: "pce" },
  { label: "Non-Farm Payrolls", calendarKeys: ["nfp"] },
  { label: "Employment Change", calendarKeys: ["employmentChange"] },
  { label: "Unemployment Rate", calendarKeys: ["unemploymentRate"], fredKey: "unemploymentRate" },
  { label: "Jobless Claims", calendarKeys: ["joblessClaims"], fredKey: "initialClaims" },
  { label: "ADP Employment", calendarKeys: ["adpEmployment"] },
  { label: "JOLTS", calendarKeys: ["jolts"] },
  { label: "Wage Growth", calendarKeys: ["avgHourlyEarnings", "wageGrowth"] },
  { label: "Policy Rate", calendarKeysByCountry: (country) => (RATE_DECISION_BY_COUNTRY[country] ? [RATE_DECISION_BY_COUNTRY[country]!.key] : []), fredKey: "policyRate" },
  { label: "2Y Yield", fredKey: "yield2y" },
];

// A calendar release has no per-indicator cadence classifier the way FRED
// does (classifyFredFreshness) — this is an admin diagnostic, not a
// scoring input, so a single generous threshold (covers monthly cadence +
// buffer) is honest and simple rather than building a second cadence
// model just for this page.
const CALENDAR_CURRENT_WITHIN_DAYS = 45;

function ageDays(dateIso: string): number {
  return Math.round((Date.now() - new Date(dateIso).getTime()) / 86_400_000);
}

/** ONE batched read per table (never per cell) — see the two coverage
 * queries' own docs for why this is safe at real data volumes. */
export async function buildEconomicCoverage(): Promise<CoverageRow[]> {
  const [eventRows, indicatorRows] = await Promise.all([getEconomicEventCoverage(), getEconomicIndicatorCoverage()]);

  const eventMap = new Map<string, string>();
  for (const r of eventRows) eventMap.set(`${r.country}:${r.indicatorKey}`, r.latestDate);

  const fredMap = new Map<string, string>();
  for (const r of indicatorRows) fredMap.set(`${r.country}:${r.indicator}`, r.latestDate);

  return COVERAGE_INDICATORS.map((def) => {
    const cells = {} as Record<TrackedCurrency, CoverageCell>;
    for (const currency of TRACKED_CURRENCIES) {
      const country = CCY_TO_COUNTRY[currency];
      const calendarKeys = def.calendarKeysByCountry ? def.calendarKeysByCountry(country) : (def.calendarKeys ?? []);

      let cell: CoverageCell = { status: "missing", latestDate: null, source: null };
      for (const key of calendarKeys) {
        const date = eventMap.get(`${country}:${key}`);
        if (date) {
          cell = { status: ageDays(date) <= CALENDAR_CURRENT_WITHIN_DAYS ? "current" : "stale", latestDate: date, source: "calendar" };
          break;
        }
      }

      if (cell.status === "missing" && def.fredKey) {
        const date = fredMap.get(`${country}:${def.fredKey}`);
        if (date) {
          const { freshness } = classifyFredFreshness(def.fredKey, date);
          cell = { status: freshness === "stale" ? "stale" : "current", latestDate: date, source: "fred" };
        }
      }

      cells[currency] = cell;
    }
    return { label: def.label, cells };
  });
}
