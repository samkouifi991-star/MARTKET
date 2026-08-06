import { Instrument, PositioningData } from "../types";
import { Rng } from "../rng";
import { NOW } from "../time";
import { instrumentRegime } from "./regime";

const cache = new Map<string, PositioningData>();

export function generatePositioning(instrument: Instrument): PositioningData {
  const cached = cache.get(instrument.symbol);
  if (cached) return cached;

  const rng = new Rng(`cot:${instrument.symbol}`);
  const totalContracts = rng.int(60_000, 420_000);
  const regime = instrumentRegime(instrument.symbol);
  // Institutional positioning usually leans with the prevailing price regime,
  // but not always — independent divergence is what the Smart Money module surfaces.
  const bias = rng.bool(0.72) ? regime : rng.float(-1, 1);
  const skew = 0.5 + bias * rng.float(0.12, 0.34);
  const longContracts = Math.round(totalContracts * Math.min(0.92, Math.max(0.08, skew)));
  const shortContracts = totalContracts - longContracts;
  const netPositioning = longContracts - shortContracts;
  const pctLong = (longContracts / totalContracts) * 100;
  const pctShort = 100 - pctLong;

  const weeklyChangeLong = Math.round(longContracts * rng.float(-0.09, 0.09));
  const weeklyChangeShort = Math.round(shortContracts * rng.float(-0.09, 0.09));
  const netWeeklyChange = weeklyChangeLong - weeklyChangeShort;

  const openInterest = totalContracts + rng.int(-5000, 5000);
  const changeOpenInterest = Math.round(openInterest * rng.float(-0.05, 0.05));

  // Build a 156-week (3yr) history of net positioning as a mean-reverting walk
  // so we can derive a genuine percentile rather than a hand-picked number.
  const weeks = 156;
  const history: { date: string; net: number }[] = [];
  let net = netPositioning - netWeeklyChange * rng.int(8, 20);
  const amplitude = Math.abs(netPositioning) * rng.float(1.1, 1.8) + totalContracts * 0.05;
  for (let i = weeks - 1; i >= 0; i--) {
    const pull = (netPositioning * 0.4 - net) * 0.03;
    net += pull + rng.float(-1, 1) * amplitude * 0.06;
    history.push({
      date: new Date(NOW.getTime() - i * 7 * 86_400_000).toISOString(),
      net: Math.round(net),
    });
  }
  history[history.length - 1] = { date: history[history.length - 1].date, net: netPositioning };

  const sorted = [...history.map((h) => h.net)].sort((a, b) => a - b);
  const rank = sorted.findIndex((v) => v >= netPositioning);
  const percentile = Math.round((rank / (sorted.length - 1)) * 100);

  const data: PositioningData = {
    symbol: instrument.symbol,
    longContracts,
    shortContracts,
    netPositioning,
    weeklyChangeLong,
    weeklyChangeShort,
    netWeeklyChange,
    pctLong,
    pctShort,
    openInterest,
    changeOpenInterest,
    percentile,
    history,
    reportDate: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
  };
  cache.set(instrument.symbol, data);
  return data;
}
