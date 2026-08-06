import { Instrument, OptionsSentiment } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";

const cache = new Map<string, OptionsSentiment>();

export function generateOptionsSentiment(instrument: Instrument): OptionsSentiment {
  const cached = cache.get(instrument.symbol);
  if (cached) return cached;

  const rng = new Rng(`options:${instrument.symbol}`);
  const putCallRatio = Number(rng.float(0.55, 1.45).toFixed(2));
  const callVolume = rng.int(200_000, 1_800_000);
  const putVolume = Math.round(callVolume * putCallRatio);

  const history: { date: string; ratio: number }[] = [];
  let walk = putCallRatio;
  for (let i = 59; i >= 0; i--) {
    walk += rng.float(-0.05, 0.05);
    walk = Math.min(1.8, Math.max(0.4, walk));
    history.push({ date: new Date(NOW.getTime() - i * 86_400_000).toISOString(), ratio: Number(walk.toFixed(2)) });
  }
  history[history.length - 1] = { date: history[history.length - 1].date, ratio: putCallRatio };

  const avg20d = Number((history.slice(-20).reduce((s, h) => s + h.ratio, 0) / 20).toFixed(2));
  const sorted = [...history.map((h) => h.ratio)].sort((a, b) => a - b);
  const percentile = Math.round((sorted.findIndex((v) => v >= putCallRatio) / (sorted.length - 1)) * 100);

  const data: OptionsSentiment = {
    symbol: instrument.symbol,
    putCallRatio,
    putVolume,
    callVolume,
    percentile,
    avg20d,
    isExtreme: percentile >= 90 || percentile <= 10,
    history,
  };
  cache.set(instrument.symbol, data);
  return data;
}
