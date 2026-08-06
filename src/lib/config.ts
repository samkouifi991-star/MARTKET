import { Bias, ScoreFactorKey } from "./types";

// All of these are presented as admin-editable in /admin. In this demo build
// they live in memory (no persistence layer is wired up) but every consumer
// reads through these functions, so wiring a real settings store later only
// touches this file.

export const DEFAULT_FACTOR_WEIGHTS: Record<ScoreFactorKey, number> = {
  institutional: 0.15,
  retailSentiment: 0.1,
  technical: 0.2,
  seasonality: 0.05,
  economicGrowth: 0.12,
  inflation: 0.1,
  labor: 0.08,
  interestRates: 0.13,
  news: 0.07,
};

export type BiasThreshold = { bias: Bias; min: number };

export const DEFAULT_BIAS_THRESHOLDS: BiasThreshold[] = [
  { bias: "Very Bullish", min: 8 },
  { bias: "Bullish", min: 4 },
  { bias: "Neutral", min: -3.9 },
  { bias: "Bearish", min: -7.9 },
  { bias: "Very Bearish", min: -Infinity },
];

export function classifyBias(score: number, thresholds: BiasThreshold[] = DEFAULT_BIAS_THRESHOLDS): Bias {
  for (const t of thresholds) {
    if (score >= t.min) return t.bias;
  }
  return "Very Bearish";
}

export const DEFAULT_RETAIL_SENTIMENT_CONFIG = {
  extremeLongThreshold: 60, // % long
  extremeShortThreshold: 60, // % short
  maxContrarianScore: 3, // points at 100% one-sided
};

export const DEFAULT_RISK_GAUGE_BANDS = [
  { label: "Strong Risk-Off" as const, max: 20 },
  { label: "Risk-Off" as const, max: 40 },
  { label: "Neutral" as const, max: 59 },
  { label: "Risk-On" as const, max: 79 },
  { label: "Strong Risk-On" as const, max: 100 },
];

export function classifyRiskGauge(value: number) {
  for (const b of DEFAULT_RISK_GAUGE_BANDS) {
    if (value <= b.max) return b.label;
  }
  return "Strong Risk-On" as const;
}

export const SUBSCRIPTION_PLANS = [
  {
    name: "Free" as const,
    price: 0,
    features: [
      "10 featured instruments",
      "Delayed scores (15 min)",
      "One watchlist",
      "5 AI Analyst questions / day",
      "No advanced alerts",
    ],
  },
  {
    name: "Pro" as const,
    price: 39,
    features: [
      "All 26 instruments",
      "Fastest available updates",
      "Unlimited watchlists",
      "Advanced alerts (email, in-app)",
      "Full scoring breakdown",
      "AI Analyst, unlimited",
      "Economic calendar & news intelligence",
    ],
  },
  {
    name: "Professional" as const,
    price: 129,
    features: [
      "Everything in Pro",
      "API access & webhooks",
      "Advanced backtesting",
      "Data export tools",
      "Team accounts",
      "Custom scoring models",
      "Priority support",
    ],
  },
];

export const DISCLAIMER =
  "For informational and educational purposes only. Not investment advice. Past performance does not guarantee future results. Scores represent analytical estimates, not certainties. Data may be delayed, estimated, or inaccurate. You are solely responsible for your own trading decisions.";
