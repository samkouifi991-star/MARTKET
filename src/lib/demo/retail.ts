import { Instrument, RetailSentimentData } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";
import { DEFAULT_RETAIL_SENTIMENT_CONFIG } from "../config";
import { instrumentRegime } from "./regime";

const cache = new Map<string, RetailSentimentData>();

export function generateRetailSentiment(instrument: Instrument): RetailSentimentData {
  const cached = cache.get(instrument.symbol);
  if (cached) return cached;

  const rng = new Rng(`retail:${instrument.symbol}`);
  const regime = instrumentRegime(instrument.symbol);
  // Retail flow tends to chase the prevailing trend (momentum/late entries),
  // which is exactly what makes strong trends prone to retail overcrowding.
  const pctLong = Math.round(Math.min(85, Math.max(15, 50 + regime * 20 + rng.float(-16, 16))) * 10) / 10;
  const pctShort = Math.round((100 - pctLong) * 10) / 10;
  const longShortRatio = Math.round((pctLong / pctShort) * 100) / 100;
  const change24h = Math.round(rng.float(-6, 6) * 10) / 10;
  const change7d = Math.round(rng.float(-14, 14) * 10) / 10;

  const { extremeLongThreshold, extremeShortThreshold } = DEFAULT_RETAIL_SENTIMENT_CONFIG;
  const isExtreme = pctLong >= extremeLongThreshold || pctShort >= extremeShortThreshold;
  let contrarianBias: RetailSentimentData["contrarianBias"] = "Neutral";
  if (pctLong > extremeLongThreshold) contrarianBias = "Bearish";
  else if (pctShort > extremeShortThreshold) contrarianBias = "Bullish";

  const weeks = 52;
  const history: { date: string; pctLong: number }[] = [];
  let walk = pctLong - change7d * rng.int(2, 5);
  for (let i = weeks - 1; i >= 0; i--) {
    walk += (pctLong - walk) * 0.05 + rng.float(-4, 4);
    walk = Math.min(90, Math.max(10, walk));
    history.push({ date: new Date(NOW.getTime() - i * 7 * 86_400_000).toISOString(), pctLong: Math.round(walk * 10) / 10 });
  }
  history[history.length - 1] = { date: history[history.length - 1].date, pctLong };

  const data: RetailSentimentData = {
    symbol: instrument.symbol,
    pctLong,
    pctShort,
    longShortRatio,
    change24h,
    change7d,
    isExtreme,
    contrarianBias,
    history,
  };
  cache.set(instrument.symbol, data);
  return data;
}
