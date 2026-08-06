import { AlertHistoryItem, AlertRule } from "../types";
import { daysAgo } from "../time";

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "al-1",
    symbol: "XAUUSD",
    type: "Score threshold",
    condition: "Total score crosses above +8 (Very Bullish)",
    channels: ["In-app", "Email"],
    enabled: true,
    createdAt: daysAgo(14),
  },
  {
    id: "al-2",
    symbol: "EURUSD",
    type: "Bias change",
    condition: "Bias changes in either direction",
    channels: ["In-app"],
    enabled: true,
    createdAt: daysAgo(9),
  },
  {
    id: "al-3",
    symbol: "BTCUSD",
    type: "Smart money divergence",
    condition: "New institutional/retail divergence signal detected",
    channels: ["In-app", "Email"],
    enabled: true,
    createdAt: daysAgo(5),
  },
  {
    id: "al-4",
    symbol: "NZDUSD",
    type: "Retail extreme",
    condition: "Retail long or short positioning exceeds 70%",
    channels: ["In-app"],
    enabled: false,
    createdAt: daysAgo(21),
  },
  {
    id: "al-5",
    symbol: "SPX500",
    type: "Risk gauge change",
    condition: "Risk gauge moves into a new band",
    channels: ["In-app", "Webhook"],
    enabled: true,
    createdAt: daysAgo(3),
  },
];

export const ALERT_HISTORY: AlertHistoryItem[] = [
  { id: "ah-1", ruleId: "al-1", symbol: "XAUUSD", message: "Gold total score crossed +8.0 (Very Bullish)", triggeredAt: daysAgo(0.4), channel: "In-app" },
  { id: "ah-2", ruleId: "al-3", symbol: "BTCUSD", message: "Bullish Smart Money Divergence detected on BTC/USD", triggeredAt: daysAgo(1.2), channel: "Email" },
  { id: "ah-3", ruleId: "al-2", symbol: "EURUSD", message: "EUR/USD bias changed from Neutral to Bullish", triggeredAt: daysAgo(2.6), channel: "In-app" },
  { id: "ah-4", ruleId: "al-5", symbol: "SPX500", message: "Risk gauge moved from Neutral into Risk-On", triggeredAt: daysAgo(3.5), channel: "In-app" },
  { id: "ah-5", ruleId: "al-1", symbol: "XAUUSD", message: "Gold total score crossed +8.0 (Very Bullish)", triggeredAt: daysAgo(6.9), channel: "In-app" },
];
