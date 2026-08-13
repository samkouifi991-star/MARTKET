// Every external provider uses its own ticker/epic/contract-code convention.
// This is the single place that translates our internal instrument symbols
// (src/lib/instruments.ts) into each provider's identifier, so no component
// or service ever hardcodes a provider-specific symbol inline.
//
// IMPORTANT — verification status: FMP tickers below follow FMP's documented,
// standard conventions and are high-confidence. The CFTC `reportName` values
// are the official CFTC "Market_and_Exchange_Names" strings the client
// matches against — these are stable, human-readable exchange listings and
// are also high-confidence. IG `epic` values are IG's internal market
// identifiers and MUST be confirmed against an IG API session (`/markets?searchTerm=`)
// before going live — they are marked `igEpic: null` (meaning "not yet
// verified against a real IG session") until then, rather than guessed. A
// wrong CFTC dataset resource ID or IG epic silently pulls the wrong
// market's data, which is worse than showing "unavailable" — see
// cftc.ts / ig.ts for where those are (or aren't yet) confirmed.

export type CftcReportType = "financial_futures" | "disaggregated" | "legacy";

export type CftcMapping = {
  reportType: CftcReportType;
  /** Official CFTC "Market_and_Exchange_Names" value to match rows against. */
  reportName: string;
};

export type SymbolMapping = {
  /** Internal instrument symbol, matches Instrument.symbol in src/lib/instruments.ts */
  symbol: string;
  fmp: {
    ticker: string;
    kind: "forex" | "index" | "commodity" | "crypto";
  };
  cftc: CftcMapping | null;
  /** IG "epic" identifier for client-sentiment lookups; null until confirmed against a live IG session. */
  igEpic: string | null;
};

export const SYMBOL_MAP: Record<string, SymbolMapping> = {
  // ---- Forex — CFTC Traders in Financial Futures (currency futures) ----
  EURUSD: { symbol: "EURUSD", fmp: { ticker: "EURUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "EURO FX - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  GBPUSD: { symbol: "GBPUSD", fmp: { ticker: "GBPUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  USDJPY: { symbol: "USDJPY", fmp: { ticker: "USDJPY", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  USDCHF: { symbol: "USDCHF", fmp: { ticker: "USDCHF", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  AUDUSD: { symbol: "AUDUSD", fmp: { ticker: "AUDUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  NZDUSD: { symbol: "NZDUSD", fmp: { ticker: "NZDUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  USDCAD: { symbol: "USDCAD", fmp: { ticker: "USDCAD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  // Crosses (EURGBP, EURJPY, GBPJPY) have no direct CFTC futures contract —
  // COT coverage is intentionally null; the UI must show institutional
  // positioning as unavailable for these rather than approximate it.
  EURGBP: { symbol: "EURGBP", fmp: { ticker: "EURGBP", kind: "forex" }, cftc: null, igEpic: null },
  EURJPY: { symbol: "EURJPY", fmp: { ticker: "EURJPY", kind: "forex" }, cftc: null, igEpic: null },
  GBPJPY: { symbol: "GBPJPY", fmp: { ticker: "GBPJPY", kind: "forex" }, cftc: null, igEpic: null },

  // ---- Indices — CFTC Traders in Financial Futures (equity index futures) ----
  SPX500: { symbol: "SPX500", fmp: { ticker: "^GSPC", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  NAS100: { symbol: "NAS100", fmp: { ticker: "^NDX", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "NASDAQ-100 CONSOLIDATED - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  DJ30: { symbol: "DJ30", fmp: { ticker: "^DJI", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "DJIA CONSOLIDATED - CHICAGO BOARD OF TRADE" }, igEpic: null },
  RUT2000: { symbol: "RUT2000", fmp: { ticker: "^RUT", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  // DAX/FTSE/Nikkei futures are not CFTC-reportable (traded on Eurex/ICE
  // Europe/OSE, outside CFTC jurisdiction) — no COT coverage exists for these.
  DAX40: { symbol: "DAX40", fmp: { ticker: "^GDAXI", kind: "index" }, cftc: null, igEpic: null },
  FTSE100: { symbol: "FTSE100", fmp: { ticker: "^FTSE", kind: "index" }, cftc: null, igEpic: null },
  NIKKEI225: { symbol: "NIKKEI225", fmp: { ticker: "^N225", kind: "index" }, cftc: null, igEpic: null },

  // ---- Commodities — CFTC Disaggregated (metals/energy) ----
  XAUUSD: { symbol: "XAUUSD", fmp: { ticker: "GCUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "GOLD - COMMODITY EXCHANGE INC." }, igEpic: null },
  XAGUSD: { symbol: "XAGUSD", fmp: { ticker: "SIUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "SILVER - COMMODITY EXCHANGE INC." }, igEpic: null },
  COPPER: { symbol: "COPPER", fmp: { ticker: "HGUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "COPPER-GRADE #1 - COMMODITY EXCHANGE INC." }, igEpic: null },
  XPTUSD: { symbol: "XPTUSD", fmp: { ticker: "PLUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "PLATINUM - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null },
  WTIUSD: { symbol: "WTIUSD", fmp: { ticker: "CLUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null },
  NATGAS: { symbol: "NATGAS", fmp: { ticker: "NGUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null },

  // ---- Crypto — CFTC Traders in Financial Futures (CME Bitcoin/Ether futures) ----
  BTCUSD: { symbol: "BTCUSD", fmp: { ticker: "BTCUSD", kind: "crypto" }, cftc: { reportType: "financial_futures", reportName: "BITCOIN - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null },
  ETHUSD: { symbol: "ETHUSD", fmp: { ticker: "ETHUSD", kind: "crypto" }, cftc: null, igEpic: null },
};

export function getSymbolMapping(symbol: string): SymbolMapping | undefined {
  return SYMBOL_MAP[symbol];
}
