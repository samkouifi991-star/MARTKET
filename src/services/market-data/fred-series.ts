// FRED series IDs per country/indicator. US series IDs below are the
// standard, long-established FRED codes (GDPC1, CPIAUCSL, UNRATE, etc.) and
// are high-confidence. FRED's non-US coverage comes largely from OECD Main
// Economic Indicators and uses a different, less mnemonic ID pattern
// (e.g. "CPALTT01DEM659N"); those entries are marked VERIFY and must be
// confirmed against https://fred.stlouisfed.org/tags/series before going
// live — an unconfirmed/wrong series ID would silently score a country
// against the wrong data, which this project's spec explicitly forbids.
// Prefer `searchSeries()` in fred.ts to confirm/discover exact IDs.

export type FredIndicatorKey =
  | "realGdp"
  | "gdpGrowth"
  | "industrialProduction"
  | "retailSales"
  | "cpi"
  | "coreCpi"
  | "pce"
  | "corePce"
  | "ppi"
  | "unemploymentRate"
  | "payrolls"
  | "initialClaims"
  | "wageGrowth"
  | "laborParticipation"
  | "policyRate"
  | "yield2y"
  | "yield10y";

export type FredCountrySeries = Partial<Record<FredIndicatorKey, { id: string; verified: boolean }>>;

export const FRED_SERIES: Record<string, FredCountrySeries> = {
  US: {
    realGdp: { id: "GDPC1", verified: true },
    gdpGrowth: { id: "A191RL1Q225SBEA", verified: true },
    industrialProduction: { id: "INDPRO", verified: true },
    retailSales: { id: "RSAFS", verified: true },
    cpi: { id: "CPIAUCSL", verified: true },
    coreCpi: { id: "CPILFESL", verified: true },
    pce: { id: "PCE", verified: true },
    corePce: { id: "PCEPILFE", verified: true },
    ppi: { id: "PPIACO", verified: true },
    unemploymentRate: { id: "UNRATE", verified: true },
    payrolls: { id: "PAYEMS", verified: true },
    initialClaims: { id: "ICSA", verified: true },
    wageGrowth: { id: "CES0500000003", verified: false },
    laborParticipation: { id: "CIVPART", verified: true },
    policyRate: { id: "FEDFUNDS", verified: true },
    yield2y: { id: "DGS2", verified: true },
    yield10y: { id: "DGS10", verified: true },
  },
  // Non-US series are lower-confidence OECD-sourced FRED mirrors — every ID
  // below needs confirmation via FRED's series search before use in scoring.
  EU: {
    // Verified against the real FRED API (npm run test:fred-verify +
    // test:fred-metadata) for the EURUSD second-phase-batch expansion:
    //   cpi (CP0000EZ19M086NEST): "Harmonized Index of Consumer Prices:
    //     Total for Euro Area (19 Countries)", Index 2025=100, Monthly,
    //     observations through 2026-07-01. Matches Inflation.
    //   unemploymentRate (LRHUTTTTEZM156S): "Harmonised Unemployment...
    //     Total: All Persons for the Euro Area (19 Countries)", Percent,
    //     Monthly — correct series for Labor Market, but FRED's own last
    //     observation is 2023-01-01 (~3.5 years stale as of this
    //     verification); the pipeline's own staleness classification
    //     (classifyFredFreshness) will correctly surface this as "stale",
    //     not "live" — same handling GB CPI already gets for its own
    //     ~17-month lag. Kept verified since the series itself is right.
    //   policyRate (ECBDFR): "ECB Deposit Facility Rate for Euro Area",
    //     Percent, Daily, observations through 2026-08-20. Matches
    //     Interest Rates.
    cpi: { id: "CP0000EZ19M086NEST", verified: true },
    unemploymentRate: { id: "LRHUTTTTEZM156S", verified: true },
    policyRate: { id: "ECBDFR", verified: true },
    yield10y: { id: "IRLTLT01EZM156N", verified: false },
  },
  GB: {
    // Verified against the real FRED API (npm run test:fred-verify +
    // test:fred-metadata) — both observations and full series metadata
    // (title/units/frequency) confirmed to match the intended factor:
    //   realGdp (NGDPRSAXDCGBQ): "Real Gross Domestic Product for Great
    //     Britain", Millions of Domestic Currency, Quarterly, Seasonally
    //     Adjusted, observations through 2026-01-01. Matches Economic Growth.
    //   gdpGrowth (NAEXKP01GBQ657S): "...GDP by Expenditure: Constant
    //     Prices: GDP: Total for United Kingdom", units "Growth rate
    //     previous period", Quarterly, Seasonally Adjusted — a rate, not a
    //     level, matching gdpGrowth's semantics the way US's
    //     A191RL1Q225SBEA does. Matches Economic Growth.
    //   cpi (GBRCPIALLMINMEI): "Consumer Price Indices... Total for United
    //     Kingdom", Index 2015=100, Monthly. Matches Inflation, but FRED's
    //     own last observation is 2025-03-01 (~17 months stale as of this
    //     verification) — the pipeline's own staleness classification
    //     (classifyByAge in gbpusd-validation.ts) will correctly surface
    //     this as "stale", not "live"; kept verified since the series
    //     itself is the right one, not a wrong mapping.
    //   unemploymentRate (LRHUTTTTGBM156S): "...Monthly Unemployment Rate
    //     Total: 15 Years or over for United Kingdom", Percent, Monthly,
    //     Seasonally Adjusted, observations through 2026-04-01. Matches
    //     Labor Market.
    //   policyRate (IUDSOIA): "Daily Sterling Overnight Index Average
    //     (SONIA) Rate", Percent, Daily, observations through 2026-08-17 —
    //     the UK's actual reference overnight rate. Matches Interest Rates.
    realGdp: { id: "NGDPRSAXDCGBQ", verified: true },
    gdpGrowth: { id: "NAEXKP01GBQ657S", verified: true },
    cpi: { id: "GBRCPIALLMINMEI", verified: true },
    unemploymentRate: { id: "LRHUTTTTGBM156S", verified: true },
    policyRate: { id: "IUDSOIA", verified: true },
    // yield10y is not consumed by any GBPUSD scoring factor (macro.ts uses
    // cpi/coreCpi/pce/corePce/ppi for Inflation, realGdp/gdpGrowth/
    // industrialProduction/retailSales for Growth, unemploymentRate/
    // payrolls/initialClaims/wageGrowth/laborParticipation for Labor, and
    // policyRate directly for Interest Rates) — left unverified until an
    // actual consumer needs it, consistent with not expanding scope here.
    yield10y: { id: "IRLTLT01GBM156N", verified: false },
  },
  JP: {
    // Verified against the real FRED API for the USDJPY second-phase-batch
    // expansion:
    //   cpi (JPNCPIALLMINMEI): "Consumer Price Indices... Total for
    //     Japan", Index 2015=100, Monthly — correct series for Inflation,
    //     but FRED's own last observation is 2021-06-01 (~5 years stale as
    //     of this verification); same "correct mapping, stale FRED data"
    //     handling as EU/unemploymentRate above — the freshness classifier
    //     downgrades it honestly rather than excluding real data.
    //   unemploymentRate (LRHUTTTTJPM156S): "Infra-Annual Labor
    //     Statistics: Monthly Unemployment Rate Total... for Japan",
    //     Percent, Monthly, observations through 2026-06-01. Matches Labor
    //     Market, fresh.
    cpi: { id: "JPNCPIALLMINMEI", verified: true },
    unemploymentRate: { id: "LRHUTTTTJPM156S", verified: true },
    yield10y: { id: "IRLTLT01JPM156N", verified: false },
  },
  CA: {
    cpi: { id: "CANCPIALLMINMEI", verified: false },
    unemploymentRate: { id: "LRHUTTTTCAM156S", verified: false },
    policyRate: { id: "IRSTCI01CAM156N", verified: false },
    yield10y: { id: "IRLTLT01CAM156N", verified: false },
  },
  AU: {
    cpi: { id: "AUSCPIALLQINMEI", verified: false },
    unemploymentRate: { id: "LRHUTTTTAUM156S", verified: false },
  },
  NZ: {
    cpi: { id: "NZLCPIALLQINMEI", verified: false },
  },
  CH: {
    cpi: { id: "CHECPIALLMINMEI", verified: false },
    policyRate: { id: "IRSTCI01CHM156N", verified: false },
  },
};

export function getFredSeriesId(country: string, indicator: FredIndicatorKey): { id: string; verified: boolean } | null {
  return FRED_SERIES[country]?.[indicator] ?? null;
}
