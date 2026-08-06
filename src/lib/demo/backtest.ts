import { BacktestBucket } from "../types";
import { Rng } from "../rng";

const SCORE_RANGES = [
  { label: "-10 to -8 (Very Bearish)", center: -9, sample: [140, 260] as const },
  { label: "-7.9 to -4 (Bearish)", center: -6, sample: [260, 420] as const },
  { label: "-3.9 to 3.9 (Neutral)", center: 0, sample: [900, 1400] as const },
  { label: "4 to 7.9 (Bullish)", center: 6, sample: [260, 420] as const },
  { label: "8 to 10 (Very Bullish)", center: 9, sample: [110, 240] as const },
];

function buildBucket(rng: Rng, label: string, center: number, sampleRange: readonly [number, number]): BacktestBucket {
  const sampleSize = rng.int(sampleRange[0], sampleRange[1]);
  // Directional edge scales with |center| but is intentionally capped and noisy —
  // this backtest is meant to show a real, modest edge, not a fantasy win rate.
  const edge = (center / 10) * rng.float(0.08, 0.16);
  const winRate1d = clampPct(50 + edge * 100 * 0.4 + rng.float(-4, 4));
  const winRate5d = clampPct(50 + edge * 100 * 0.65 + rng.float(-5, 5));
  const winRate20d = clampPct(50 + edge * 100 * 0.5 + rng.float(-7, 7));
  return {
    scoreRange: label,
    sampleSize,
    winRate1d,
    winRate5d,
    winRate20d,
    avgReturn1d: Number((edge * 1.1 + rng.float(-0.05, 0.05)).toFixed(3)),
    avgReturn5d: Number((edge * 2.6 + rng.float(-0.15, 0.15)).toFixed(3)),
    avgReturn20d: Number((edge * 4.4 + rng.float(-0.4, 0.4)).toFixed(3)),
    avgMFE: Number((Math.abs(edge) * 6 + rng.float(0.3, 1.2)).toFixed(2)),
    avgMAE: Number((-(Math.abs(edge) * 4 + rng.float(0.4, 1.5))).toFixed(2)),
  };
}

function clampPct(v: number): number {
  return Math.round(Math.max(28, Math.min(72, v)));
}

export function scoreRangeBacktest(): BacktestBucket[] {
  const rng = new Rng("backtest-score-range");
  return SCORE_RANGES.map((r) => buildBucket(rng, r.label, r.center, r.sample));
}

export function assetClassBacktest(): Record<string, BacktestBucket[]> {
  const classes = ["Forex", "Indices", "Commodities", "Crypto"];
  const out: Record<string, BacktestBucket[]> = {};
  for (const cls of classes) {
    const rng = new Rng(`backtest-class-${cls}`);
    out[cls] = SCORE_RANGES.map((r) => buildBucket(rng, r.label, r.center, r.sample));
  }
  return out;
}

export function volRegimeBacktest(): Record<"Low Volatility" | "Normal" | "High Volatility", BacktestBucket[]> {
  const regimes = ["Low Volatility", "Normal", "High Volatility"] as const;
  const out: Record<string, BacktestBucket[]> = {};
  for (const regime of regimes) {
    const rng = new Rng(`backtest-vol-${regime}`);
    out[regime] = SCORE_RANGES.map((r) => {
      const dampening = regime === "High Volatility" ? 0.6 : regime === "Low Volatility" ? 1.15 : 1;
      return buildBucket(rng, r.label, r.center * dampening, r.sample);
    });
  }
  return out as Record<"Low Volatility" | "Normal" | "High Volatility", BacktestBucket[]>;
}

export function riskRegimeBacktest(): Record<"Risk-On" | "Risk-Off", BacktestBucket[]> {
  const regimes = ["Risk-On", "Risk-Off"] as const;
  const out: Record<string, BacktestBucket[]> = {};
  for (const regime of regimes) {
    const rng = new Rng(`backtest-risk-${regime}`);
    out[regime] = SCORE_RANGES.map((r) => buildBucket(rng, r.label, r.center, r.sample));
  }
  return out as Record<"Risk-On" | "Risk-Off", BacktestBucket[]>;
}
