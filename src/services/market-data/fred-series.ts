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
    cpi: { id: "CP0000EZ19M086NEST", verified: false },
    unemploymentRate: { id: "LRHUTTTTEZM156S", verified: false },
    policyRate: { id: "ECBDFR", verified: false },
    yield10y: { id: "IRLTLT01EZM156N", verified: false },
  },
  GB: {
    cpi: { id: "GBRCPIALLMINMEI", verified: false },
    unemploymentRate: { id: "LRHUTTTTGBM156S", verified: false },
    policyRate: { id: "IUDSOIA", verified: false },
    yield10y: { id: "IRLTLT01GBM156N", verified: false },
  },
  JP: {
    cpi: { id: "JPNCPIALLMINMEI", verified: false },
    unemploymentRate: { id: "LRHUTTTTJPM156S", verified: false },
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
