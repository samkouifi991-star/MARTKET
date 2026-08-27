// A broader, 10-bucket DISPLAY-only categorization for the Calendar/Admin
// UI (economic_events.category). Deliberately separate from indicator-
// taxonomy.ts's indicatorCategory() (4-bucket: inflation/growthLabor/
// rateDecision/other), which feeds Scoring Engine V2's regime/correlation
// dispatch — that function is untouched by this module and must stay so.
// Never imported by anything under lib/scoring-v2/.
import { EconomicIndicatorKey } from "./indicator-taxonomy";

export type DisplayCategory =
  | "inflation"
  | "labor"
  | "growth"
  | "consumption"
  | "manufacturing"
  | "services"
  | "housing"
  | "central_bank"
  | "rates"
  | "other";

const INFLATION: EconomicIndicatorKey[] = ["cpi", "coreCpi", "ppi", "corePpi", "pce", "corePce", "inflationExpectations", "michiganInflationExpectations"];
const LABOR: EconomicIndicatorKey[] = ["nfp", "unemploymentRate", "avgHourlyEarnings", "joblessClaims", "continuingClaims", "jolts", "adpEmployment", "productivity", "unitLaborCosts"];
const GROWTH: EconomicIndicatorKey[] = ["gdp", "gdpRevision", "industrialProduction", "tradeBalance"];
const CONSUMPTION: EconomicIndicatorKey[] = ["retailSales", "consumerConfidence", "michiganSentiment"];
const MANUFACTURING: EconomicIndicatorKey[] = ["ismManufacturing", "spGlobalManufacturingPmi", "durableGoods"];
const SERVICES: EconomicIndicatorKey[] = ["ismServices", "spGlobalServicesPmi"];
const HOUSING: EconomicIndicatorKey[] = ["housingData"];
const CENTRAL_BANK: EconomicIndicatorKey[] = [
  "fedRateDecision",
  "fomcStatement",
  "dotPlot",
  "powellPressConference",
  "fomcMinutes",
  "ecbRateDecision",
  "boeRateDecision",
  "bojRateDecision",
  "snbRateDecision",
  "bocRateDecision",
  "rbaRateDecision",
  "rbnzRateDecision",
];

export function deriveDisplayCategory(key: EconomicIndicatorKey | null): DisplayCategory {
  if (key === null) return "other";
  if (INFLATION.includes(key)) return "inflation";
  if (LABOR.includes(key)) return "labor";
  if (GROWTH.includes(key)) return "growth";
  if (CONSUMPTION.includes(key)) return "consumption";
  if (MANUFACTURING.includes(key)) return "manufacturing";
  if (SERVICES.includes(key)) return "services";
  if (HOUSING.includes(key)) return "housing";
  if (CENTRAL_BANK.includes(key)) return "central_bank";
  return "other";
}
