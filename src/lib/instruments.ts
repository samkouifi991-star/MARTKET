import { AssetClass, Instrument } from "./types";

// Administrators can extend this list without touching the scoring engine —
// every module derives its demo data from this table via the instrument symbol.
export const INSTRUMENTS: Instrument[] = [
  { symbol: "EURUSD", name: "Euro / US Dollar", assetClass: "Forex", currencies: ["EUR", "USD"], decimals: 4 },
  { symbol: "GBPUSD", name: "British Pound / US Dollar", assetClass: "Forex", currencies: ["GBP", "USD"], decimals: 4 },
  { symbol: "USDJPY", name: "US Dollar / Japanese Yen", assetClass: "Forex", currencies: ["USD", "JPY"], decimals: 2 },
  { symbol: "USDCHF", name: "US Dollar / Swiss Franc", assetClass: "Forex", currencies: ["USD", "CHF"], decimals: 4 },
  { symbol: "AUDUSD", name: "Australian Dollar / US Dollar", assetClass: "Forex", currencies: ["AUD", "USD"], decimals: 4 },
  { symbol: "NZDUSD", name: "New Zealand Dollar / US Dollar", assetClass: "Forex", currencies: ["NZD", "USD"], decimals: 4 },
  { symbol: "USDCAD", name: "US Dollar / Canadian Dollar", assetClass: "Forex", currencies: ["USD", "CAD"], decimals: 4 },
  { symbol: "EURGBP", name: "Euro / British Pound", assetClass: "Forex", currencies: ["EUR", "GBP"], decimals: 4 },
  { symbol: "EURJPY", name: "Euro / Japanese Yen", assetClass: "Forex", currencies: ["EUR", "JPY"], decimals: 2 },
  { symbol: "GBPJPY", name: "British Pound / Japanese Yen", assetClass: "Forex", currencies: ["GBP", "JPY"], decimals: 2 },

  // macroCountry names each index's real home market so its macro factors
  // use that country's actual growth/inflation/labor/rates as the primary
  // local model — not a generic US proxy. See lib/types.ts's doc comment.
  { symbol: "SPX500", name: "S&P 500", assetClass: "Indices", macroCountry: "US", decimals: 2 },
  { symbol: "NAS100", name: "NASDAQ 100", assetClass: "Indices", macroCountry: "US", decimals: 2 },
  { symbol: "DJ30", name: "Dow Jones Industrial Average", assetClass: "Indices", macroCountry: "US", decimals: 2 },
  { symbol: "RUT2000", name: "Russell 2000", assetClass: "Indices", macroCountry: "US", decimals: 2 },
  { symbol: "DAX40", name: "DAX", assetClass: "Indices", macroCountry: "DE", decimals: 2 },
  { symbol: "FTSE100", name: "FTSE 100", assetClass: "Indices", macroCountry: "GB", decimals: 2 },
  { symbol: "NIKKEI225", name: "Nikkei 225", assetClass: "Indices", macroCountry: "JP", decimals: 2 },

  { symbol: "XAUUSD", name: "Gold", assetClass: "Commodities", decimals: 2 },
  { symbol: "XAGUSD", name: "Silver", assetClass: "Commodities", decimals: 3 },
  { symbol: "COPPER", name: "Copper", assetClass: "Commodities", decimals: 3 },
  { symbol: "XPTUSD", name: "Platinum", assetClass: "Commodities", decimals: 2 },
  { symbol: "WTIUSD", name: "Crude Oil (WTI)", assetClass: "Commodities", decimals: 2 },
  { symbol: "NATGAS", name: "Natural Gas", assetClass: "Commodities", decimals: 3 },

  { symbol: "BTCUSD", name: "Bitcoin", assetClass: "Crypto", decimals: 0 },
  { symbol: "ETHUSD", name: "Ethereum", assetClass: "Crypto", decimals: 2 },
];

export const ASSET_CLASSES: AssetClass[] = ["Forex", "Indices", "Commodities", "Crypto"];

export function getInstrument(symbol: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}

// Demo set highlighted by the platform (section 35): guaranteed to include a
// bullish, bearish, neutral, missing-data and stale-data example.
export const FEATURED_DEMO_SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "XAUUSD",
  "BTCUSD",
  "SPX500",
  "NAS100",
  "DJ30",
  "WTIUSD",
  "XAGUSD",
];
