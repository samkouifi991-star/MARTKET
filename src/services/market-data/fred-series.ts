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
    // Verified against the real FRED API for the EURGBP/EURJPY macro batch
    // (EU had cpi/unemploymentRate/policyRate but no growth series at all):
    //   realGdp (CLVMNACSCAB1GQEA19): "Real Gross Domestic Product for Euro
    //     Area (19 Countries)", Millions of Chained 2010 Euros, Quarterly,
    //     Seasonally Adjusted, observations through 2026-04-01. Euro-
    //     denominated like CH's realGdp — harmless, see macro-differential.ts's
    //     scoreIndicator() (z-scores period-over-period changes only, never
    //     absolute cross-currency levels). Matches Economic Growth.
    //   gdpGrowth (NAEXKP01EZQ657S): same "...GDP by Expenditure: Constant
    //     Prices..." pattern every other country's gdpGrowth uses, "Growth
    //     rate previous period", Quarterly, Seasonally Adjusted — but FRED's
    //     own last observation is 2023-01-01 (~3.5 years stale as of this
    //     verification), the same "correct mapping, stale FRED data"
    //     handling as EU/unemploymentRate above. Kept verified.
    cpi: { id: "CP0000EZ19M086NEST", verified: true },
    unemploymentRate: { id: "LRHUTTTTEZM156S", verified: true },
    policyRate: { id: "ECBDFR", verified: true },
    yield10y: { id: "IRLTLT01EZM156N", verified: false },
    realGdp: { id: "CLVMNACSCAB1GQEA19", verified: true },
    gdpGrowth: { id: "NAEXKP01EZQ657S", verified: true },
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
    // Verified against the real FRED API for the NIKKEI225 batch, same
    // GB/AU/CA patterns: realGdp/gdpGrowth both fresh (through
    // 2026-01-01); policyRate (IRSTCI01JPM156N) — "Interest Rates:
    // Immediate Rates... Interbank Rate: Total for Japan" — fresh (through
    // 2026-06-01), the real BoJ-equivalent series.
    realGdp: { id: "NGDPRSAXDCJPQ", verified: true },
    gdpGrowth: { id: "NAEXKP01JPQ657S", verified: true },
    policyRate: { id: "IRSTCI01JPM156N", verified: true },
    yield10y: { id: "IRLTLT01JPM156N", verified: false },
  },
  CA: {
    // Verified against the real FRED API (npm run test:fred-verify +
    // test:fred-metadata) for the USDCAD batch:
    //   cpi (CANCPIALLMINMEI): correct series, Index 2015=100, Monthly,
    //     but FRED's own last observation is 2025-03-01 (~17 months stale
    //     as of this verification) — same "correct mapping, stale FRED
    //     data" handling as GB/EU/AU CPI; kept verified.
    //   unemploymentRate (LRHUTTTTCAM156S): Percent, Monthly, fresh
    //     (through 2026-07-01).
    //   policyRate (IRSTCI01CAM156N): "Interest Rates: Immediate Rates
    //     (<24h): Call Money/Interbank Rate: Total for Canada", Percent,
    //     Monthly, fresh (through 2026-06-01). Matches Interest Rates.
    //   realGdp (NGDPRSAXDCCAQ) / gdpGrowth (NAEXKP01CAQ657S): same
    //     IMF IFS / OECD MEI patterns already verified for GB/AU, both
    //     fresh (through 2026-01-01 / 2026-04-01).
    cpi: { id: "CANCPIALLMINMEI", verified: true },
    unemploymentRate: { id: "LRHUTTTTCAM156S", verified: true },
    policyRate: { id: "IRSTCI01CAM156N", verified: true },
    yield10y: { id: "IRLTLT01CAM156N", verified: false },
    realGdp: { id: "NGDPRSAXDCCAQ", verified: true },
    gdpGrowth: { id: "NAEXKP01CAQ657S", verified: true },
  },
  AU: {
    // Verified against the real FRED API for the AUDUSD batch — same
    // confirmation process as CA above:
    //   cpi (AUSCPIALLQINMEI): correct series, Index 2015=100, Quarterly,
    //     ~19 months stale as of this verification (through 2025-01-01) —
    //     same "correct mapping, stale FRED data" handling as GB/EU/CA.
    //   unemploymentRate (LRHUTTTTAUM156S): Percent, Monthly, fresh
    //     (through 2026-06-01).
    //   realGdp (NGDPRSAXDCAUQ) / gdpGrowth (NAEXKP01AUQ657S): fresh
    //     (through 2026-01-01), same pattern as GB/CA.
    //   policyRate (IRSTCI01AUM156N): "Interest Rates: Immediate Rates
    //     (<24h): Call Money/Interbank Rate: Total for Australia", Percent,
    //     Monthly, fresh (through 2026-06-01) — the real RBA-equivalent
    //     series, confirmed by title, not guessed.
    cpi: { id: "AUSCPIALLQINMEI", verified: true },
    unemploymentRate: { id: "LRHUTTTTAUM156S", verified: true },
    realGdp: { id: "NGDPRSAXDCAUQ", verified: true },
    gdpGrowth: { id: "NAEXKP01AUQ657S", verified: true },
    policyRate: { id: "IRSTCI01AUM156N", verified: true },
  },
  NZ: {
    // Verified against the real FRED API for the NZDUSD batch:
    //   cpi: correct series, but FRED's own last observation is
    //     2025-01-01 (~19 months stale) — same "correct mapping, stale
    //     FRED data" handling as GB/EU/AU/CH CPI; kept verified.
    //   gdpGrowth (NAEXKP01NZQ657S): matches the exact established
    //     pattern/title, fresh (through 2026-01-01).
    //   unemploymentRate (LRHUTTTTNZQ156S): same series family as
    //     GB/AU/CA/JP ("15 Years or over"), fresh (through 2026-04-01) —
    //     genuinely quarterly in FRED (NZ's Household Labour Force Survey
    //     is quarterly, unlike GB/AU/JP's monthly data), hence "Q" not
    //     "M" in the ID despite the inherited OECD title text still
    //     reading "Monthly Unemployment Rate".
    //   policyRate (IRSTCI01NZM156N): correct RBNZ-equivalent series,
    //     ~20 months stale (through 2024-12-01) — same stale-but-correct
    //     handling as CH's policyRate below.
    // realGdp deliberately NOT verified: NZLGDPRQPSMEI (the only
    // candidate FRED's search returned) turned out to be a "Growth rate
    // same period previous year" series, not a real-GDP level like every
    // other country's realGdp entry — feeding a growth rate into a slot
    // meant for a level would double-differentiate it. gdpGrowth alone
    // already covers NZ's Growth category with a correctly-typed series.
    cpi: { id: "NZLCPIALLQINMEI", verified: true },
    gdpGrowth: { id: "NAEXKP01NZQ657S", verified: true },
    unemploymentRate: { id: "LRHUTTTTNZQ156S", verified: true },
    policyRate: { id: "IRSTCI01NZM156N", verified: true },
    realGdp: { id: "NZLGDPRQPSMEI", verified: false },
  },
  CH: {
    // Verified against the real FRED API for the USDCHF batch:
    //   cpi: correct series, ~16 months stale (through 2025-04-01) —
    //     same stale-but-correct handling as GB/EU/AU/NZ CPI.
    //   policyRate: correct SNB-equivalent series, ~2.5 years stale
    //     (through 2024-03-01) — the staleness classifier downgrades this
    //     honestly rather than excluding real data, same principle as
    //     every other stale-but-correctly-mapped series here.
    //   realGdp (CLVMNACSAB1GQCH): title confirms "Real Gross Domestic
    //     Product for Switzerland", fresh (through 2026-01-01) — units
    //     are "Millions of Chained 2010 Euros" (a real Eurostat
    //     cross-country-comparability convention for non-Euro European
    //     economies, not a data error). Harmless for scoring: the engine
    //     (macro-differential.ts's scoreIndicator) only ever z-scores
    //     period-over-period CHANGES, never absolute cross-currency
    //     levels, so the Euro denomination doesn't affect the signal.
    //   gdpGrowth: matches the exact established pattern/title, fresh
    //     (through 2026-01-01).
    //   unemploymentRate (LRUN64TTCHQ156S): a real, correctly-titled CH
    //     unemployment series, fresh (through 2026-01-01) — covers ages
    //     15-64 rather than GB/AU/CA/JP's "15 Years or over", a genuinely
    //     different definition (no equivalent "15+" series exists for CH
    //     in FRED), but still a legitimate real unemployment rate.
    cpi: { id: "CHECPIALLMINMEI", verified: true },
    policyRate: { id: "IRSTCI01CHM156N", verified: true },
    realGdp: { id: "CLVMNACSAB1GQCH", verified: true },
    gdpGrowth: { id: "NAEXKP01CHQ657S", verified: true },
    unemploymentRate: { id: "LRUN64TTCHQ156S", verified: true },
  },
  // DE: needed for DAX40's macro. Discovered via a real FRED search
  // (fred-verify.ts) and confirmed via real metadata (fred-metadata-check.ts):
  //   realGdp (CLVMNACSCAB1GQDE): title confirms "Real Gross Domestic
  //     Product for Germany", Seasonally Adjusted, fresh (through
  //     2026-04-01) — uses the EU-style "SCA" 3-letter code (the simpler
  //     single-country "SA" 2-letter variant CH uses did not appear in
  //     Germany's real search results at all, so this is the confirmed
  //     ID, not an assumption from CH's pattern).
  //   gdpGrowth (NAEXKP01DEQ657S): matches the exact established pattern/
  //     title used by every other verified country, Seasonally Adjusted,
  //     fresh (through 2026-04-01).
  //   cpi (DEUCPIALLMINMEI): correct title, Not Seasonally Adjusted (same
  //     convention as every other verified country's cpi), fresh enough
  //     (through 2025-03-01).
  //   policyRate (IRSTCI01DEM156N): matches the exact established Call
  //     Money/Interbank Rate pattern/title, fresh (through 2026-06-01).
  // unemploymentRate is deliberately NOT included here: the metadata
  // confirmation request for LRHUTTTTDEM156S (the pattern-matching
  // candidate real search returned) hit a genuine FRED-side HTTP 500 — it
  // was never confirmed, so per this project's rule it is left unconfigured
  // rather than guessed. DAX40's labor factor will read unavailable (or
  // demo-fallback in hybrid) until this is retried and actually confirmed.
  DE: {
    realGdp: { id: "CLVMNACSCAB1GQDE", verified: true },
    gdpGrowth: { id: "NAEXKP01DEQ657S", verified: true },
    cpi: { id: "DEUCPIALLMINMEI", verified: true },
    policyRate: { id: "IRSTCI01DEM156N", verified: true },
  },
};

export function getFredSeriesId(country: string, indicator: FredIndicatorKey): { id: string; verified: boolean } | null {
  return FRED_SERIES[country]?.[indicator] ?? null;
}
