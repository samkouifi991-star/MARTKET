import { INSTRUMENTS, getInstrument } from "./instruments";
import { generatePriceData } from "./demo/price";
import { computeMarketScore } from "./scoring";
import { DataFreshness, Instrument, MarketScore, PriceData } from "./types";

export type MarketRow = {
  instrument: Instrument;
  price: PriceData;
  // Always "estimated" here — allMarketRows()/marketRow() are the pure-demo
  // generator, never a canonical Neon read. See pipeline/top-setups.ts's
  // getCanonicalMarketRows() for the real, per-DATA_MODE canonical
  // equivalent every live-data page reads instead.
  priceFreshness: DataFreshness;
  score: MarketScore;
};

let cachedRows: MarketRow[] | null = null;

export function allMarketRows(): MarketRow[] {
  if (cachedRows) return cachedRows;
  cachedRows = INSTRUMENTS.map((instrument) => ({
    instrument,
    price: generatePriceData(instrument),
    priceFreshness: "estimated",
    score: computeMarketScore(instrument),
  }));
  return cachedRows;
}

export function marketRow(symbol: string): MarketRow | undefined {
  const instrument = getInstrument(symbol);
  if (!instrument) return undefined;
  return {
    instrument,
    price: generatePriceData(instrument),
    priceFreshness: "estimated",
    score: computeMarketScore(instrument),
  };
}
