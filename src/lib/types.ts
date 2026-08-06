export type AssetClass = "Forex" | "Indices" | "Commodities" | "Crypto";

export type Bias =
  | "Very Bullish"
  | "Bullish"
  | "Neutral"
  | "Bearish"
  | "Very Bearish";

export type Instrument = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** For FX pairs: [base, quote] currency codes used to pull two-sided macro data. */
  currencies?: [string, string];
  decimals: number;
};

export const SCORE_FACTOR_KEYS = [
  "institutional",
  "retailSentiment",
  "technical",
  "seasonality",
  "economicGrowth",
  "inflation",
  "labor",
  "interestRates",
  "news",
] as const;

export type ScoreFactorKey = (typeof SCORE_FACTOR_KEYS)[number];

export const FACTOR_LABELS: Record<ScoreFactorKey, string> = {
  institutional: "Institutional positioning",
  retailSentiment: "Retail sentiment",
  technical: "Technical trend",
  seasonality: "Seasonality",
  economicGrowth: "Economic growth",
  inflation: "Inflation conditions",
  labor: "Labor market",
  interestRates: "Interest-rate conditions",
  news: "News & geopolitical risk",
};

export type DataFreshness = "live" | "delayed" | "estimated" | "stale";

export type ScoreFactor = {
  key: ScoreFactorKey;
  contribution: number; // weighted, signed points contributed to total score
  rawScore: number; // normalized -10..+10 before weighting
  weight: number; // 0..1
  explanation: string;
  source: string;
  freshness: DataFreshness;
  lastUpdated: string; // ISO
  nextUpdate: string; // ISO
};

export type ScoreHistoryPoint = {
  date: string; // ISO date
  score: number;
};

export type MarketScore = {
  symbol: string;
  totalScore: number;
  bias: Bias;
  confidence: number; // 0-100
  change24h: number;
  factors: ScoreFactor[];
  history: ScoreHistoryPoint[];
  lastUpdated: string;
};

export type PricePoint = { date: string; price: number };

export type PriceData = {
  symbol: string;
  current: number;
  changePct24h: number;
  series: PricePoint[]; // daily closes
  ema20: number;
  sma50: number;
  sma100: number;
  sma200: number;
  rsi14: number;
  adx14: number;
  roc10: number;
  structure: "Higher Highs & Higher Lows" | "Lower Highs & Lower Lows" | "Choppy / Mixed";
};

export type PositioningData = {
  symbol: string;
  longContracts: number;
  shortContracts: number;
  netPositioning: number;
  weeklyChangeLong: number;
  weeklyChangeShort: number;
  netWeeklyChange: number;
  pctLong: number;
  pctShort: number;
  openInterest: number;
  changeOpenInterest: number;
  percentile: number; // current net positioning percentile vs 3yr history
  history: { date: string; net: number }[];
  reportDate: string;
};

export type RetailSentimentData = {
  symbol: string;
  pctLong: number;
  pctShort: number;
  longShortRatio: number;
  change24h: number;
  change7d: number;
  isExtreme: boolean;
  contrarianBias: "Bullish" | "Bearish" | "Neutral";
  history: { date: string; pctLong: number }[];
};

export type DivergenceSignal =
  | "Bullish Smart Money Divergence"
  | "Bearish Smart Money Divergence"
  | "Crowded Institutional Trade"
  | "Retail Capitulation"
  | "Positioning Reversal"
  | "None";

export type SmartMoneyData = {
  symbol: string;
  signal: DivergenceSignal;
  confidence: number;
  explanation: string;
};

export type SeasonalityStat = {
  period: string; // e.g. "August", "Week 32", "Monday"
  avgReturn: number;
  medianReturn: number;
  pctPositive: number;
  pctNegative: number;
  bestReturn: number;
  worstReturn: number;
  years: number;
  avg10y: number;
  avg20y: number | null;
  maxDrawdown: number;
};

export type EconomicRelease = {
  id: string;
  country: string;
  indicator: string;
  previous: number;
  forecast: number;
  actual: number;
  revision: number | null;
  surprise: number;
  /** Whether a higher actual value is the economically favorable direction (false for e.g. unemployment rate, jobless claims). */
  higherIsBetter: boolean;
  unit: string;
  releaseDate: string;
  nextRelease: string;
  impactedMarkets: string[];
  history: { date: string; actual: number }[];
  trend3m: "Improving" | "Deteriorating" | "Stable";
  trend6m: "Improving" | "Deteriorating" | "Stable";
};

export type InflationRelease = EconomicRelease;
export type LaborRelease = EconomicRelease;

export type CentralBank = {
  code: string;
  name: string;
  currency: string;
  currentRate: number;
  previousRate: number;
  nextMeeting: string;
  probHike: number;
  probHold: number;
  probCut: number;
  yield2y: number;
  yield10y: number;
  yieldCurveSlope: number;
  stance: "Hawkish" | "Neutral" | "Dovish";
  stanceScore: number; // -10..10
  lastStatement: string;
};

export type OptionsSentiment = {
  symbol: string;
  putCallRatio: number;
  putVolume: number;
  callVolume: number;
  percentile: number;
  avg20d: number;
  isExtreme: boolean;
  history: { date: string; ratio: number }[];
};

export type InvestorSentiment = {
  bullishPct: number;
  bearishPct: number;
  neutralPct: number;
  bullBearSpread: number;
  fearGreedIndex: number;
  volatilityIndex: number;
  creditSpread: number;
  safeHavenDemand: "Low" | "Moderate" | "High";
};

export type NewsImpact = "Bullish" | "Bearish" | "Mixed" | "Neutral" | "Unclear";

export type NewsArticle = {
  id: string;
  headline: string;
  source: string;
  publishedAt: string;
  affectedMarkets: string[];
  interpretation: NewsImpact;
  importance: number; // 0-100
  urgency: number; // 0-100
  confidence: number; // 0-100
  expectedImpactDuration: string;
  relatedStoryIds: string[];
  explanation: string;
  isPriced: boolean;
  topic: string;
};

export type CalendarImpact = "Low" | "Medium" | "High";

export type CalendarEvent = {
  id: string;
  dateTime: string;
  country: string;
  event: string;
  impact: CalendarImpact;
  forecast: string;
  previous: string;
  actual: string | null;
  revision: string | null;
  affectedMarkets: string[];
  historicalReaction: string;
};

export type AlertRule = {
  id: string;
  symbol: string;
  type:
    | "Score threshold"
    | "Bias change"
    | "Confidence increase"
    | "Institutional shift"
    | "Retail extreme"
    | "Smart money divergence"
    | "High-impact release"
    | "Major news"
    | "Technical reversal"
    | "Risk gauge change"
    | "Watchlist entry";
  condition: string;
  channels: ("In-app" | "Email" | "SMS" | "Push" | "Webhook")[];
  enabled: boolean;
  createdAt: string;
};

export type AlertHistoryItem = {
  id: string;
  ruleId: string;
  symbol: string;
  message: string;
  triggeredAt: string;
  channel: string;
};

export type Watchlist = {
  id: string;
  name: string;
  symbols: string[];
};

export type RiskGaugeComponent = {
  label: string;
  contribution: number; // -20..20 toward the 0-100 gauge (centered at 0)
  detail: string;
};

export type RiskGaugeData = {
  value: number; // 0-100
  label: "Strong Risk-Off" | "Risk-Off" | "Neutral" | "Risk-On" | "Strong Risk-On";
  components: RiskGaugeComponent[];
  history: { date: string; value: number }[];
};

export type BacktestBucket = {
  scoreRange: string;
  sampleSize: number;
  winRate1d: number;
  winRate5d: number;
  winRate20d: number;
  avgReturn1d: number;
  avgReturn5d: number;
  avgReturn20d: number;
  avgMFE: number;
  avgMAE: number;
};

export type SubscriptionPlan = "Free" | "Pro" | "Professional";
