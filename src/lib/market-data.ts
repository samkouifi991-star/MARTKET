import { INSTRUMENTS, getInstrument } from "./instruments";
import { generatePriceData } from "./demo/price";
import { computeMarketScore } from "./scoring";
import { Instrument, MarketScore, PriceData } from "./types";

export type MarketRow = {
  instrument: Instrument;
  price: PriceData;
  score: MarketScore;
};

let cachedRows: MarketRow[] | null = null;

export function allMarketRows(): MarketRow[] {
  if (cachedRows) return cachedRows;
  cachedRows = INSTRUMENTS.map((instrument) => ({
    instrument,
    price: generatePriceData(instrument),
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
    score: computeMarketScore(instrument),
  };
}
