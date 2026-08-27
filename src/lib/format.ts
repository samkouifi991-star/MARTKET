export function formatPrice(value: number, decimals: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatSigned(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}`;
}

export function formatSignedPct(value: number, decimals = 2): string {
  return `${formatSigned(value, decimals)}%`;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function biasColorClasses(bias: string): string {
  switch (bias) {
    case "Very Bullish":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    case "Bullish":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
    case "Neutral":
      return "text-slate-300 bg-slate-500/10 border-slate-500/25";
    case "Bearish":
      return "text-rose-300 bg-rose-500/10 border-rose-500/20";
    case "Very Bearish":
      return "text-rose-400 bg-rose-500/10 border-rose-500/30";
    default:
      return "text-slate-300 bg-slate-500/10 border-slate-500/25";
  }
}

export function scoreColorClass(value: number): string {
  if (value >= 4) return "text-emerald-400";
  if (value <= -4) return "text-rose-400";
  return "text-slate-300";
}

export type FactorSentiment = "Bullish" | "Bearish" | "Neutral";

/** Per-factor (not total-score) sentiment: any positive contribution is
 * Bullish, any negative is Bearish, exactly zero is Neutral. Distinct from
 * scoreColorClass's ±4 bands, which are calibrated for the -10..+10 total
 * score, not a single factor's much smaller weighted contribution. */
export function factorSentiment(contribution: number): FactorSentiment {
  if (contribution > 0) return "Bullish";
  if (contribution < 0) return "Bearish";
  return "Neutral";
}

export function factorSentimentBadgeClasses(sentiment: FactorSentiment): string {
  switch (sentiment) {
    case "Bullish":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "Bearish":
      return "text-rose-400 bg-rose-500/10 border-rose-500/25";
    case "Neutral":
      return "text-slate-400 bg-slate-500/10 border-slate-500/25";
  }
}

export function factorContributionColorClass(contribution: number): string {
  if (contribution > 0) return "text-emerald-400";
  if (contribution < 0) return "text-rose-400";
  return "text-slate-400";
}

export type StrengthLevel = "Very Strong" | "Strong" | "Moderate" | "Weak" | "Very Weak";

/** Bands a -100..100 composite currency-strength score (see
 * lib/pipeline/economic-strength.ts) into a 5-tier label — mirrors
 * biasColorClasses's tier boundaries/coloring so the two badge families
 * read consistently across the product. */
export function strengthLevelForScore(score: number): StrengthLevel {
  if (score >= 60) return "Very Strong";
  if (score >= 20) return "Strong";
  if (score > -20) return "Moderate";
  if (score > -60) return "Weak";
  return "Very Weak";
}

export function strengthBadgeClasses(level: StrengthLevel): string {
  switch (level) {
    case "Very Strong":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    case "Strong":
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/20";
    case "Moderate":
      return "text-slate-300 bg-slate-500/10 border-slate-500/25";
    case "Weak":
      return "text-rose-300 bg-rose-500/10 border-rose-500/20";
    case "Very Weak":
      return "text-rose-400 bg-rose-500/10 border-rose-500/30";
  }
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function riskLevelBadgeClasses(level: RiskLevel): string {
  switch (level) {
    case "LOW":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/25";
    case "MEDIUM":
      return "text-amber-400 bg-amber-500/10 border-amber-500/25";
    case "HIGH":
      return "text-orange-400 bg-orange-500/10 border-orange-500/25";
    case "CRITICAL":
      return "text-rose-400 bg-rose-500/10 border-rose-500/30";
  }
}
