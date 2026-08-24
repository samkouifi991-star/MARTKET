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
// `myfxbookSymbol` follows Myfxbook's plain FX-broker-style tickers
// (high-confidence for majors/crosses/gold/silver) but is likewise not yet
// confirmed against a live get-community-outlook.json response — see
// retail-sentiment/myfxbook.ts. Myfxbook is no longer the primary retail-
// sentiment source (its session/auth flow proved unreliable for this
// deployment) — see retail-sentiment/index.ts for the current priority
// order (OANDA, then IG, then Myfxbook as a fallback-only last resort).
// `oandaInstrument` follows OANDA's official v20 REST API instrument-naming
// convention (BASE_QUOTE, e.g. "GBP_USD") for the FX majors/crosses OANDA's
// PositionBook endpoint documents coverage for — high-confidence since the
// convention is stable and publicly documented, but like every other
// provider identifier here, not yet confirmed against a live response; see
// retail-sentiment/oanda.ts.

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
  /** Myfxbook Community Outlook symbol — Myfxbook uses plain FX-broker-style
   * tickers (e.g. "GBPUSD") for majors/crosses and covers a handful of metals,
   * so this is high-confidence for those and null elsewhere. Still unverified
   * against a live get-community-outlook.json response — see myfxbook.ts.
   * Myfxbook is fallback-only now (see retail-sentiment/index.ts); this
   * field stays populated so it still works if OANDA/IG are ever both down. */
  myfxbookSymbol: string | null;
  /** OANDA v20 instrument name for PositionBook retail-sentiment lookups
   * (e.g. "GBP_USD"). Populated only for the FX majors/crosses OANDA's
   * PositionBook documents coverage for; null elsewhere — never guessed for
   * an instrument without confirmed coverage. See retail-sentiment/oanda.ts. */
  oandaInstrument: string | null;
  /** Capital.com "marketId" identifier for GET /api/v1/clientsentiment/{marketId}
   * lookups. Null everywhere until confirmed against a real Capital.com
   * session's GET /api/v1/markets?searchTerm= response — same discipline as
   * igEpic above. See scripts/capital-com-retail-sentiment-verify.ts (the
   * verification-only script, does not write back here) and
   * retail-sentiment/capital-com-provider.ts, which is built and ready but
   * not yet registered in retail-sentiment/index.ts pending that
   * verification. */
  capitalComMarketId: string | null;
};

export const SYMBOL_MAP: Record<string, SymbolMapping> = {
  // ---- Forex — CFTC Traders in Financial Futures (currency futures) ----
  EURUSD: { symbol: "EURUSD", fmp: { ticker: "EURUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "EURO FX - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "EURUSD", oandaInstrument: "EUR_USD", capitalComMarketId: null },
  GBPUSD: { symbol: "GBPUSD", fmp: { ticker: "GBPUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "BRITISH POUND STERLING - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "GBPUSD", oandaInstrument: "GBP_USD", capitalComMarketId: null },
  USDJPY: { symbol: "USDJPY", fmp: { ticker: "USDJPY", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "USDJPY", oandaInstrument: "USD_JPY", capitalComMarketId: null },
  USDCHF: { symbol: "USDCHF", fmp: { ticker: "USDCHF", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "SWISS FRANC - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "USDCHF", oandaInstrument: "USD_CHF", capitalComMarketId: null },
  AUDUSD: { symbol: "AUDUSD", fmp: { ticker: "AUDUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "AUDUSD", oandaInstrument: "AUD_USD", capitalComMarketId: null },
  NZDUSD: { symbol: "NZDUSD", fmp: { ticker: "NZDUSD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "NEW ZEALAND DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "NZDUSD", oandaInstrument: "NZD_USD", capitalComMarketId: null },
  USDCAD: { symbol: "USDCAD", fmp: { ticker: "USDCAD", kind: "forex" }, cftc: { reportType: "financial_futures", reportName: "CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: "USDCAD", oandaInstrument: "USD_CAD", capitalComMarketId: null },
  // Crosses (EURGBP, EURJPY, GBPJPY) have no direct CFTC futures contract —
  // COT coverage is intentionally null; the UI must show institutional
  // positioning as unavailable for these rather than approximate it.
  EURGBP: { symbol: "EURGBP", fmp: { ticker: "EURGBP", kind: "forex" }, cftc: null, igEpic: null, myfxbookSymbol: "EURGBP", oandaInstrument: "EUR_GBP", capitalComMarketId: null },
  EURJPY: { symbol: "EURJPY", fmp: { ticker: "EURJPY", kind: "forex" }, cftc: null, igEpic: null, myfxbookSymbol: "EURJPY", oandaInstrument: "EUR_JPY", capitalComMarketId: null },
  GBPJPY: { symbol: "GBPJPY", fmp: { ticker: "GBPJPY", kind: "forex" }, cftc: null, igEpic: null, myfxbookSymbol: "GBPJPY", oandaInstrument: "GBP_JPY", capitalComMarketId: null },

  // ---- Indices — CFTC Traders in Financial Futures (equity index futures) ----
  SPX500: { symbol: "SPX500", fmp: { ticker: "^GSPC", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  // NAS100/DJ30: cftc-verify.ts flagged the previous all-caps reportName
  // values ("NASDAQ-100 CONSOLIDATED", "DJIA CONSOLIDATED") as resolving
  // via discovery but returning 0 rows from an exact-match fetch — found
  // (scripts/cftc-find-indices.ts, run against the real CFTC API) to be a
  // pure case mismatch: CFTC's actual market_and_exchange_names strings
  // use mixed case ("Consolidated", not "CONSOLIDATED"), confirmed fresh
  // (latest report 2026-08-11) under the correct casing below.
  // NAS100 PRICE SOURCE: currently NOT USABLE on this account's FMP plan.
  // scripts/nas100-index-discovery.ts (run against FMP's real /index-list
  // and quote/historical endpoints) found and tested every genuine
  // Nasdaq-100 candidate: ^NDX (the index itself), ^XNDX (Total Return
  // variant), and — as an explicit ETF-proxy fallback, never to be
  // silently presented as the index — QQQ. All three returned 402 Payment
  // Required on both /quote and /historical-price-eod/full. This isn't a
  // symbol-mapping error or an index-specific gap: QQQ hitting the same
  // 402 shows this plan simply doesn't include individual equity/ETF
  // quote+historical access, only the specific asset classes already
  // working (forex, commodities, crypto, and a couple of pre-whitelisted
  // major indices — ^GSPC/SPX500 and ^DJI/DJ30 are both confirmed live).
  // NAS100 stays NOT_PROMOTED (no substitute index, ETF, or synthetic
  // price — see data-mode.ts) until one of:
  //   1. an FMP plan upgrade becomes worthwhile for multiple markets at
  //      once, not just this one — decide from the full remaining-market
  //      coverage picture (scripts/fmp-coverage-test.ts), not NAS100 alone
  //   2. a dedicated index data provider is integrated (e.g. Massive)
  //   3. NAS100 is deliberately left unsupported
  // The CFTC mapping below is unaffected by any of this and stays fixed
  // and verified, ready for whichever price source is eventually chosen.
  NAS100: { symbol: "NAS100", fmp: { ticker: "^NDX", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  DJ30: { symbol: "DJ30", fmp: { ticker: "^DJI", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "DJIA Consolidated - CHICAGO BOARD OF TRADE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  RUT2000: { symbol: "RUT2000", fmp: { ticker: "^RUT", kind: "index" }, cftc: { reportType: "financial_futures", reportName: "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  // DAX/FTSE/Nikkei futures are not CFTC-reportable (traded on Eurex/ICE
  // Europe/OSE, outside CFTC jurisdiction) — no COT coverage exists for these.
  DAX40: { symbol: "DAX40", fmp: { ticker: "^GDAXI", kind: "index" }, cftc: null, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  FTSE100: { symbol: "FTSE100", fmp: { ticker: "^FTSE", kind: "index" }, cftc: null, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  NIKKEI225: { symbol: "NIKKEI225", fmp: { ticker: "^N225", kind: "index" }, cftc: null, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },

  // ---- Commodities — CFTC Disaggregated (metals/energy) ----
  XAUUSD: { symbol: "XAUUSD", fmp: { ticker: "GCUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "GOLD - COMMODITY EXCHANGE INC." }, igEpic: null, myfxbookSymbol: "XAUUSD", oandaInstrument: null, capitalComMarketId: null },
  XAGUSD: { symbol: "XAGUSD", fmp: { ticker: "SIUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "SILVER - COMMODITY EXCHANGE INC." }, igEpic: null, myfxbookSymbol: "XAGUSD", oandaInstrument: null, capitalComMarketId: null },
  COPPER: { symbol: "COPPER", fmp: { ticker: "HGUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "COPPER-GRADE #1 - COMMODITY EXCHANGE INC." }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  XPTUSD: { symbol: "XPTUSD", fmp: { ticker: "PLUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "PLATINUM - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  WTIUSD: { symbol: "WTIUSD", fmp: { ticker: "CLUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  NATGAS: { symbol: "NATGAS", fmp: { ticker: "NGUSD", kind: "commodity" }, cftc: { reportType: "disaggregated", reportName: "NATURAL GAS - NEW YORK MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },

  // ---- Crypto — CFTC Traders in Financial Futures (CME Bitcoin/Ether futures) ----
  BTCUSD: { symbol: "BTCUSD", fmp: { ticker: "BTCUSD", kind: "crypto" }, cftc: { reportType: "financial_futures", reportName: "BITCOIN - CHICAGO MERCANTILE EXCHANGE" }, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
  ETHUSD: { symbol: "ETHUSD", fmp: { ticker: "ETHUSD", kind: "crypto" }, cftc: null, igEpic: null, myfxbookSymbol: null, oandaInstrument: null, capitalComMarketId: null },
};

export function getSymbolMapping(symbol: string): SymbolMapping | undefined {
  return SYMBOL_MAP[symbol];
}
